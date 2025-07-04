import { 
    Injectable, 
    NotFoundException, 
    BadRequestException 
} from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import { CreateLikeDto } from "./dto/create-like.dto";

@Injectable()
export class LikeService {
    constructor(private readonly prisma: PrismaService) { }

    async create(createLikeDto: CreateLikeDto, context: { userId: string }) {
        try {
            const template = await this.prisma.template.findUnique({
                where: { id: createLikeDto.templateId }
            });
            
            if (!template) {
                throw new NotFoundException('Template not found');
            }

            const existingLike = await this.prisma.likes.findFirst({ 
                where: { 
                    templateId: createLikeDto.templateId, 
                    userId: context.userId 
                } 
            });
            
            if (!existingLike) {
                await this.prisma.likes.create({
                    data: { 
                        templateId: createLikeDto.templateId, 
                        userId: context.userId 
                    }
                });
                return { action: 'liked' };
            } else {
                await this.prisma.likes.delete({ where: { id: existingLike.id } });
                return { action: 'unliked' };
            }
        } catch (error) {
            console.error('Error in like service:', error);
            throw new BadRequestException(error.message || 'Failed to toggle like');
        }
    }

async findAllTemplateLikes(templateId: string) {
  const templateExists = await this.prisma.template.findFirst({
    where: { id: templateId },
    select: { id: true },
  });

  if (!templateExists) {
    return {
      templateId,
      likes: [],
      count: 0,
      likedByCurrentUser: false,
    };
  }

  const likes = await this.prisma.likes.findMany({
    where: { templateId },
  });

  return {
    templateId,
    likes,
    count: likes.length,
    likedByCurrentUser: false, 
  };
}

}