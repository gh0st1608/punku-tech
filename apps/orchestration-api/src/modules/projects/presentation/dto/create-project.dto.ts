import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";
import { projectPriorities, projectStatuses } from "@aief/contracts";
import type { CreateProjectRequest } from "@aief/contracts";

export class CreateProjectDto implements CreateProjectRequest {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Matches(/\S/)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsIn(projectStatuses)
  status?: CreateProjectRequest["status"];

  @IsOptional()
  @IsIn(projectPriorities)
  priority?: CreateProjectRequest["priority"];
}
