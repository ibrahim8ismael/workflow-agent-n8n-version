export interface IRuntime {
  id: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IRuntimeExecution {
  id: string;
  runtimeId: string;
  status: string;
  startedAt?: Date;
  completedAt?: Date;
}
