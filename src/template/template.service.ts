import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { PrismaService } from '../prisma/prisma.service';
import { Request } from 'express';
import { FORM_TYPE, Prisma, ROLE } from '@prisma/client';

@Injectable()
export class TemplateService {
  constructor(private readonly prisma: PrismaService) { }

  async create(createTemplateDto: CreateTemplateDto, req: Request) {
    try {
      const userId = req['user'].id;
      const {
        Question,
        allowedUsers,
        tagIds,
        tags,
        ...templateData
      } = createTemplateDto;

      const template = await this.prisma.template.create({
        data: {
          ...templateData,
          userId,

          ...(tagIds && tagIds.length > 0 ? {
            tags: {
              connect: tagIds.map((id) => ({ id })),
            },
          } : {}),

          ...(Question?.length && {
            Question: {
              create: Question.map((q) => ({
                title: q.title,
                sequence: q.sequence,
                description: q.description ?? '',
                type: q.type,
                isPublished: q.isPublished,
                createdById: userId,
                Options: {
                  create: q.Options?.map((o) => ({ title: o.title })) ?? [],
                },
              })),
            },
          }),

          ...(templateData.type === 'PRIVATE' && allowedUsers?.length && {
            TemplateAccess: {
              create: allowedUsers.map((u) => ({ userId: u.id })),
            },
          }),
        },

        include: {
          Question: { include: { Options: true } },
          TemplateAccess: true,
          tags: true,
        },
      });

      return template;
    } catch (error) {
      console.error(error);
      throw new HttpException('Template creation failed', HttpStatus.BAD_REQUEST);
    }
  }

  async findAll(req: Request, search?: string) {
    try {
      const userId = req['user']?.id;
      let isAdmin = false;

      if (userId) {
        const user = await this.prisma.user.findUnique({
          where: { id: userId },
        });
        isAdmin = user?.role === ROLE.ADMIN;
      }

      const searchCondition = search
        ? {
          OR: [
            { title: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
          ],
        }
        : {};

      const whereConditions: any[] = [
        {
          type: FORM_TYPE.PUBLIC,
          ...searchCondition,
        },
      ];

      if (userId) {
        const privateTemplateAccess = isAdmin
          ? {}
          : {
            TemplateAccess: {
              some: { userId },
            },
          };

        whereConditions.push({
          type: FORM_TYPE.PRIVATE,
          ...privateTemplateAccess,
          ...searchCondition,
        });
      }

      const templates = await this.prisma.template.findMany({
        where: {
          OR: whereConditions,
        },
        include: {
          TemplateAccess: true,
          user: { select: { username: true } },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      return templates;
    } catch (error) {
      console.error(error);
      throw error;
    }
  }

  async findAllUserTemplates(req: Request, search?: string) {
    try {
      const userId = req['user'].id;

      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });

      const isAdmin = user?.role === ROLE.ADMIN;

      const searchCondition = search
        ? {
          OR: [
            { title: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
          ],
        }
        : {};

      const whereCondition: any = {
        ...searchCondition,
      };

      if (!isAdmin) {
        whereCondition.userId = userId;
      }

      const templates = await this.prisma.template.findMany({
        where: whereCondition,
        include: {
          Question: true,
        },
      });

      return templates;
    } catch (error) {
      console.error(error);
      throw error;
    }
  }

  async getUserTemplatesByToken(token: string) {
    try {
      const user = await this.prisma.user.findUnique({ where: { apiToken: token } })
      if (user) {
        const templates = await this.prisma.template.findMany({
          where: { userId: user.id },
          include: {
            Question:
            {
              select:
              {
                id: true,
                sequence: true,
                title: true,
                description: true,
                type: true,
                isPublished: true,
                Answer: true
              }
            },
          },
        });
        return templates;
      }
    } catch (error) {

    }
  }

  async getTop5PopularTemplates(req: Request) {
    const userId = req['user']?.id;
    let isAdmin = false;

    if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });
      isAdmin = user?.role === ROLE.ADMIN;
    }

    const accessCondition: any[] = [
      { type: FORM_TYPE.PUBLIC },
    ];

    if (userId) {
      const privateAccess = isAdmin
        ? {}
        : {
          TemplateAccess: {
            some: { userId },
          },
        };

      accessCondition.push({
        type: FORM_TYPE.PRIVATE,
        ...privateAccess,
      });
    }

    const templates = await this.prisma.template.findMany({
      where: {
        OR: accessCondition,
      },
      include: {
        _count: { select: { Form: true } },
        user: { select: { username: true } },
      },
      orderBy: {
        Form: { _count: 'desc' },
      },
      take: 5,
    });

    return templates;
  }

  async findOne(id: string) {
    try {
      const template = await this.prisma.template.findUnique({
        where: { id },
        include: {
          Question: { include: { Options: true } },
          tags: { select: { id: true, name: true } },
          TemplateAccess: {
            select: {
              user: { select: { id: true, username: true } },
            },
          },
        },
      });

      if (!template) throw new NotFoundException('Not found');

      const allowedUsers = (template.TemplateAccess ?? []).map((a) => ({
        id: a.user.id,
        username: a.user.username,
      }));

      const { TemplateAccess: _, ...rest } = template;
      // const tags = template.tags?.map((tag) => tag.id)
      return { ...rest, TemplateAccess: allowedUsers };
    } catch (err) {
      console.error(err);
      throw err;
    }
  }

  async update(id: string, dto: UpdateTemplateDto) {
    const {
      Question: qs = [],
      allowedUsers,
      TemplateAccess: tAcc,
      tagIds = [],
      ...tpl
    } = dto as any;

    const ex = await this.prisma.template.findUnique({
      where: { id },
      include: { Question: { include: { Options: true } } },
    });
    if (!ex) throw new HttpException('Template not found', 404);

    await this.prisma.question.deleteMany({
      where: {
        id: {
          in: ex.Question.filter((q) => !qs.some((i) => i.id === q.id)).map(
            (q) => q.id,
          ),
        },
      },
    });

    const qUpd = qs
      .filter((q) => q.id)
      .map((q) => {
        const optionIdsFromClient =
          q.Options?.filter((o) => o.id)?.map((o) => o.id) ?? [];

        return {
          where: { id: q.id },
          data: {
            title: q.title,
            sequence: q.sequence,
            description: q.description ?? '',
            type: q.type,
            isPublished: q.isPublished,
            Options: {
              deleteMany: {
                id: {
                  notIn: optionIdsFromClient,
                },
              },
              updateMany:
                q.Options?.filter((o) => o.id).map((o) => ({
                  where: { id: o.id },
                  data: { title: o.title },
                })) ?? [],
              createMany: {
                data:
                  q.Options?.filter((o) => !o.id).map((o) => ({
                    title: o.title,
                  })) ?? [],
              },
            },
          },
        };
      });

    const qNew = qs
      .filter((q) => !q.id)
      .map((q) => ({
        title: q.title,
        sequence: q.sequence,
        description: q.description ?? '',
        type: q.type,
        isPublished: q.isPublished,
        Options: {
          create: q.Options?.map((o) => ({
            title: o.title,
          })) ?? [],
        },
      }));

    const ids = [
      ...new Set(
        (allowedUsers ?? tAcc ?? [])
          .map((u: any) => ('id' in u ? u.id : u.user?.id))
          .filter(Boolean),
      ),
    ] as string[];

    const data: Prisma.TemplateUpdateInput = {
      ...tpl,
      Question: {
        update: qUpd,
        create: qNew,
      },
      TemplateAccess:
        tpl.type === 'PRIVATE'
          ? {
            deleteMany: {},
            createMany: {
              data: ids.map((userId) => ({ userId })),
              skipDuplicates: true,
            },
          }
          : { deleteMany: {} },
      ...(Array.isArray(tagIds) && {
        tags: {
          set: tagIds.map((id) => ({ id })),
        },
      }),
    };

    const updated = await this.prisma.template.update({
      where: { id },
      data,
      include: {
        Question: { include: { Options: true } },
        TemplateAccess: {
          select: {
            user: {
              select: { id: true, username: true },
            },
          },
        },
        tags: true,
      },
    });

    const allowed = updated.TemplateAccess.map((a) => ({
      id: a.user.id,
      username: a.user.username,
    }));

    const { TemplateAccess, ...rest } = updated;
    return {
      ...rest,
      TemplateAccess: allowed,
    };
  }

  async remove(templateIds: string[]) {
    try {
      await this.prisma.options.deleteMany({
        where: {
          question: {
            templateId: {
              in: templateIds,
            },
          },
        },
      });

      await this.prisma.question.deleteMany({
        where: {
          templateId: {
            in: templateIds,
          },
        },
      });

      const deleted = await this.prisma.template.deleteMany({
        where: {
          id: { in: templateIds },
        },
      });

      return deleted;
    } catch (error) {
      console.error(error);
      throw new HttpException(
        'Failed to delete templates',
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
