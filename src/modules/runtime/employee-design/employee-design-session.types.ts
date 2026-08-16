import type { z } from 'zod';
import { blueprintSchema } from './employee-blueprint.schema';

export type EmployeeBlueprint = z.infer<typeof blueprintSchema>;

export type EmployeeDesignStatus = 'GATHERING_REQUIREMENTS' | 'READY_FOR_REVIEW' | 'CREATED';

export type EmployeeDesignApprovalStatus = 'NOT_READY' | 'READY' | 'APPROVED';

export interface EmployeeDesignSession {
  status: EmployeeDesignStatus;
  approvalStatus: EmployeeDesignApprovalStatus;
  blueprint?: EmployeeBlueprint;
  missingRequirements: string[];
  blueprintRevision?: string;
  createdEmployeeId?: string;
  sourceConversationId?: string;
  sourceDesignRunId?: string;
}
