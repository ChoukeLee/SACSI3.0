type PageResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
  count?: number | null;
};

/**
 * Fetches a stable ordered Supabase query in pages so dashboards never silently
 * become "latest N rows" reports. The caller must include a deterministic order.
 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  label: string,
  pageSize = 1_000,
): Promise<T[]> {
  const rows: T[] = [];
  if(!Number.isInteger(pageSize)||pageSize<1||pageSize>1000) throw new Error("Invalid database page size");
  let expectedCount: number | null = null;

  for (let from = 0; ;) {
    const { data, error, count } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error(`Failed to fetch ${label}: ${error.message}`);
    if(!data) throw new Error(`Missing data while fetching ${label}`);
    if(count !== undefined && count !== null) {
      if(expectedCount !== null && count !== expectedCount) throw new Error(`Data changed while fetching ${label}; retry`);
      expectedCount=count;
    }
    rows.push(...data);
    if(expectedCount !== null) {
      if(rows.length===expectedCount)return rows;
      if(!data.length || rows.length>expectedCount)throw new Error(`Incomplete data while fetching ${label}`);
    } else if(data.length<pageSize)return rows;
    from+=data.length;
  }
}
