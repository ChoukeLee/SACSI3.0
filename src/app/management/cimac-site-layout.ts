export const CIMAC_SITE_ROWS = {
  north: [10, 8, 6, 4, 2],
  south: [9, 7, 5, 3, 1],
} as const;

export function orderCimacShopsForPlan<T extends { unitNo: string }>(buildingNumber: number, shops: T[]): T[] {
  const northSide = buildingNumber % 2 === 0;
  if (buildingNumber > 4) {
    return [...shops].sort((left, right) => (Number(left.unitNo) - Number(right.unitNo)) * (northSide ? -1 : 1));
  }

  return [...shops].sort((left, right) => {
    const leftNo = Number(left.unitNo);
    const rightNo = Number(right.unitNo);
    const rowOrder = Math.floor((leftNo - 1) / 2) - Math.floor((rightNo - 1) / 2);
    if (rowOrder !== 0) return rowOrder * (northSide ? -1 : 1);
    return (leftNo % 2) - (rightNo % 2);
  });
}
