import { Transform } from "class-transformer";
import { IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";

function trimString(value: unknown): unknown {
  return typeof value === "string" ? value.trim() : value;
}

export class CreateExecutionDto {
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MaxLength(120)
  name?: string;

  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(10)
  @MaxLength(12000)
  requirement!: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1000)
  budgetUsd?: number;
}
