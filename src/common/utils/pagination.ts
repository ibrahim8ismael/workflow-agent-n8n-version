export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export function paginate<T>(
  data: T[],
  total: number,
  params: PaginationParams,
): PaginatedResult<T> {
  const page = params.page ?? 1;
  const limit = params.limit ?? 20;

  return {
    data,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
}
