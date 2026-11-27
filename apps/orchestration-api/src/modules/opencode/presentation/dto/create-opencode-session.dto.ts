import { IsIn, IsString, MaxLength, MinLength } from "class-validator";
import { agentIds } from "@aief/contracts";

export class CreateOpenCodeSessionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  @IsIn(agentIds)
  agentId!: (typeof agentIds)[number];
}
