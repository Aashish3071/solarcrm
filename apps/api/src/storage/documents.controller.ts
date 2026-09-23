import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { DOCUMENT_TYPES, UPLOAD_MAX_BYTES, UPLOAD_MIME_TYPES, canUpload, currentStage, type DocumentType, type Stage } from "@solarcrm/shared";
import { randomUUID } from "node:crypto";
import type { Response } from "express";
import { AuditService } from "../common/audit.service";
import { CurrentUser, RequireModule, type AuthUser } from "../common/auth-context";
import { RuleViolation } from "../common/validation";
import { PrismaService } from "../prisma.service";
import { ProjectsService } from "../projects/projects.service";
import { StorageService, sniffMime } from "./storage.service";

@Controller()
@RequireModule("projects")
export class DocumentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  @Post("projects/:id/documents")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: UPLOAD_MAX_BYTES, files: 1 } }))
  async upload(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body("type") type: string,
  ) {
    if (!(DOCUMENT_TYPES as readonly string[]).includes(type)) throw new RuleViolation(["Choose a document type."]);
    if (!canUpload(user.role, type as DocumentType)) throw new ForbiddenException("Your role cannot upload this document.");
    if (!file?.buffer?.length) throw new RuleViolation(["Choose a file to upload."]);
    const mime = sniffMime(file.buffer);
    if (!mime || !(UPLOAD_MIME_TYPES as readonly string[]).includes(mime)) {
      throw new RuleViolation(["Only PDF, JPEG, PNG or WebP files are accepted."]);
    }

    const project = await this.prisma.project.findFirst({ where: { id, ...this.projects.scope(user) } });
    if (!project) throw new NotFoundException("Project not found.");

    const stage =
      currentStage({ completed: project.completedStages as Stage[], skipped: project.skippedStages as Stage[], loanRequired: project.loanRequired }) ??
      "CLOSED";
    const safeName = file.originalname.replace(/[^\w.\- ]+/g, "_").slice(-120) || "file";
    const storageKey = `${project.id}/${stage}/${randomUUID()}`;
    await this.storage.put(storageKey, file.buffer);
    const doc = await this.prisma.document.create({
      data: { projectId: id, type: type as DocumentType, stage, fileName: safeName, mimeType: mime, size: file.size, storageKey, uploadedById: user.id },
    });
    await this.audit.record({ actorId: user.id, action: "document.uploaded", entity: "Project", entityId: id, meta: { documentId: doc.id, type } });
    return { id: doc.id, type: doc.type, fileName: doc.fileName, size: doc.size, uploadedAt: doc.uploadedAt };
  }

  @Get("documents/:docId/file")
  async download(@CurrentUser() user: AuthUser, @Param("docId") docId: string, @Res({ passthrough: true }) res: Response) {
    const doc = await this.prisma.document.findFirst({ where: { id: docId, project: this.projects.scope(user) } });
    if (!doc) throw new NotFoundException("Document not found.");
    res.set({
      "Content-Type": doc.mimeType,
      "Content-Disposition": `inline; filename="${doc.fileName.replace(/"/g, "")}"`,
      "X-Content-Type-Options": "nosniff",
    });
    return new StreamableFile(this.storage.read(doc.storageKey));
  }
}
