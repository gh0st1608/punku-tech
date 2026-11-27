import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";
import { projectPriorities, projectStatuses } from "@aief/contracts";
import type { UpdateProjectRequest } from "@aief/contracts";

export class UpdateProjectDto implements UpdateProjectRequest {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Matches(/\S/)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsIn(projectStatuses)
  status?: UpdateProjectRequest["status"];

  @IsOptional()
  @IsIn(projectPriorities)
  priority?: UpdateProjectRequest["priority"];
}
