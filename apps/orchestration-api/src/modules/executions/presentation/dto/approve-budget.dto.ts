import { IsNumber, Max, Min } from "class-validator";

export class ApproveBudgetDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1000)
  newBudgetUsd!: number;
}
