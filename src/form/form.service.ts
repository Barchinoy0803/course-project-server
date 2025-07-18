import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CreateFormDto } from './dto/create-form.dto';
import { UpdateFormDto } from './dto/update-form.dto';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FormService {
  constructor(private readonly prisma: PrismaService) { }

  async create(createFormDto: CreateFormDto, req: Request) {
    try {
      const userId = req['user'].id;
      const { Answer, templateId } = createFormDto;

      const template = await this.prisma.template.findUnique({
        where: { id: templateId }
      });

      if (!template) {
        throw new NotFoundException(`Template with ID ${templateId} not found`);
      }

      return await this.prisma.form.create({
        data: {
          template: { connect: { id: templateId } },
          user: { connect: { id: userId } },
          answer: {
            create: Answer?.map(a => ({
              sequence: a.sequence,
              answer: Array.isArray(a.answer) ? 'MULTICHOICE' : String(a.answer),
              question: { connect: { id: a.questionId } },
              user: { connect: { id: userId } },
              selectedOptionOnAnswer: {
                create: Array.isArray(a.answer)
                  ? a.answer.map(optionId => ({
                    option: { connect: { id: optionId } },
                    isSelected: true
                  }))
                  : []
              }
            })) || []
          }
        },
        include: {
          answer: {
            include: {
              selectedOptionOnAnswer: {
                include: {
                  option: true
                }
              }
            }
          }
        }
      });
    } catch (error) {
      if (error.code === 'P2003') {
        throw new BadRequestException('Invalid relation: One of the referenced IDs does not exist');
      }
      throw error;
    }
  }

  async isExistingTemplate(templateId: string, req: Request) {
    try {
      const userId = req['user'].id
      const filledTemplate = await this.prisma.form.findFirst({ where: { templateId, userId } })

      if (filledTemplate) return filledTemplate
      return false
    } catch (error) {
      throw error
    }
  }

  async findAll() {
    try {
      const forms = await this.prisma.form.findMany({
        include: {
          template: true,
        },
      });
      return forms;
    } catch (error) {
      throw error
    }
  }

  async findAllUserForms(req: Request) {
    try {
      const userId = req['user'].id;
      const forms = await this.prisma.form.findMany({
        where: { userId },
        include: {
          template: true,
        },
      });
      return forms;
    } catch (error) {
      throw error;
    }
  }

  async findForms(req: Request) {
    try {
      const userId = req['user'].id;
      const forms = await this.prisma.form.findMany({
        where: {
          template: { userId },
        },
        include: {
          template: true,
        },
      });
      return forms;
    } catch (error) {
      throw error
    }
  }

  async findOne(id: string) {
    try {
      const form = await this.prisma.form.findUnique({
        where: { id },
        include: {
          answer: {
            orderBy: { sequence: 'asc' },
            include: {
              selectedOptionOnAnswer: {
                select: { optionId: true },
              },
            },
          },
        },
      });

      if (!form) {
        throw new HttpException('Not found this form', HttpStatus.NOT_FOUND);
      }

      form.answer = form.answer.map((answer) => ({
        ...answer,
        selectedOptionOnAnswer: answer.selectedOptionOnAnswer.map((s) => s.optionId),
      })) as any;

      return form;
    } catch (error) {
      throw error
    }
  }

  async update(id: string, updateFormDto: UpdateFormDto, req: Request) {
    try {
      const userId = req['user']?.id;

      const existingForm = await this.prisma.form.findUnique({
        where: { id },
        include: { answer: true },
      });

      if (!existingForm) {
        throw new NotFoundException('Form not found');
      }

      const existingIds = existingForm.answer.map((a) => a.id);
      const incoming = updateFormDto.Answer || [];

      const incomingIds = incoming.filter((a) => a.id).map((a) => a.id);
      const idsToDelete = existingIds.filter((id) => !incomingIds.includes(id));
      const toUpdate = incoming.filter((a) => a.id);
      const toCreate = incoming.filter((a) => !a.id);

      if (idsToDelete.length > 0) {
        await this.prisma.selectedOptionOnAnswer.deleteMany({
          where: { answerId: { in: idsToDelete } },
        });

        await this.prisma.answer.deleteMany({
          where: { id: { in: idsToDelete } },
        });
      }

      await Promise.all(
        toUpdate.map((a) =>
          this.prisma.answer.update({
            where: { id: a.id },
            data: {
              sequence: a.sequence,
              answer: Array.isArray(a.answer) ? 'MULTICHOICE' : String(a.answer),
              questionId: a.questionId,
            },
          })
        )
      );

      await Promise.all(
        toUpdate
          .filter((a) => Array.isArray(a.answer) && a.selectedOptionOnAnswer?.length)
          .map(async (a) => {
            const answerId = a.id!;
            await this.prisma.selectedOptionOnAnswer.deleteMany({
              where: { answerId },
            });

            const existingOptions = await this.prisma.options.findMany({
              where: {
                id: { in: a.selectedOptionOnAnswer },
              },
              select: { id: true },
            });

            const validOptionIds = new Set(existingOptions.map((o) => o.id));
            const data = a.selectedOptionOnAnswer!
              .filter((optionId) => validOptionIds.has(optionId))
              .map((optionId) => ({
                answerId,
                optionId,
                isSelected: true,
              }));

            if (data.length > 0) {
              await this.prisma.selectedOptionOnAnswer.createMany({
                data,
                skipDuplicates: true,
              });
            }
          })
      );

      for (const a of toCreate) {
        const created = await this.prisma.answer.create({
          data: {
            sequence: a.sequence,
            answer: Array.isArray(a.answer) ? 'MULTICHOICE' : String(a.answer),
            questionId: a.questionId,
            formId: id,
            userId: userId,
          },
        });

        if (Array.isArray(a.answer) && a.selectedOptionOnAnswer?.length) {
          const existingOptions = await this.prisma.options.findMany({
            where: {
              id: { in: a.selectedOptionOnAnswer },
            },
            select: { id: true },
          });

          const validOptionIds = new Set(existingOptions.map((o) => o.id));
          const data = a.selectedOptionOnAnswer
            .filter((optionId) => validOptionIds.has(optionId))
            .map((optionId) => ({
              answerId: created.id,
              optionId,
              isSelected: true,
            }));

          if (data.length > 0) {
            await this.prisma.selectedOptionOnAnswer.createMany({
              data,
              skipDuplicates: true,
            });
          }
        }
      }

      if (updateFormDto.templateId) {
        const templateExists = await this.prisma.template.findUnique({
          where: { id: updateFormDto.templateId },
        });

        if (!templateExists) {
          throw new BadRequestException('Invalid templateId — Template not found');
        }
      }

      const updatedForm = await this.prisma.form.update({
        where: { id },
        data: {
          ...(updateFormDto.templateId && { templateId: updateFormDto.templateId }),
        },
        include: {
          answer: {
            include: {
              selectedOptionOnAnswer: {
                include: {
                  option: true,
                },
              },
            },
          },
        },
      });

      return updatedForm;
    } catch (error) {
      throw new InternalServerErrorException('Failed to update form');
    }
  }


  async remove(formIds: string[]) {
    try {
      const answers = await this.prisma.answer.findMany({
        where: {
          formId: { in: formIds },
        },
        select: { id: true },
      });

      const answerIds = answers.map((a) => a.id);

      if (answerIds.length > 0) {
        await this.prisma.selectedOptionOnAnswer.deleteMany({
          where: {
            answerId: {
              in: answerIds,
            },
          },
        });

        await this.prisma.answer.deleteMany({
          where: {
            id: { in: answerIds },
          },
        });
      }

      await this.prisma.form.deleteMany({
        where: {
          id: { in: formIds },
        },
      });

      return { message: 'Forms and related data successfully deleted' };
    } catch (error) {
      throw new Error('Failed to delete forms and related data');
    }
  }

}