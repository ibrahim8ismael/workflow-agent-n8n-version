export interface EmployeeBlueprintValidation {
  valid: boolean;
  missing: string[];
}

const meaningful = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length >= 3;

const meaningfulList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.some((item) => meaningful(item));

export function validateEmployeeBlueprint(
  blueprint: Record<string, unknown>,
): EmployeeBlueprintValidation {
  const missing: string[] = [];
  const requiredFields: Array<[string, unknown]> = [
    ['name', blueprint.name],
    ['role', blueprint.role],
    ['department', blueprint.department],
    ['description', blueprint.description],
    ['instructions', blueprint.instructions],
  ];

  for (const [field, value] of requiredFields) {
    if (!meaningful(value)) missing.push(field);
  }

  if (!meaningfulList(blueprint.responsibilities)) missing.push('responsibilities');
  if (!meaningfulList(blueprint.goals)) missing.push('goals');
  if (!meaningfulList(blueprint.permissions)) missing.push('boundaries / permissions');

  return { valid: missing.length === 0, missing };
}
