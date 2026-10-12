export function reportTags(types = []) {
  const value = types.join("、");
  return [["性侵", /性侵/], ["虐待", /虐待/], ["拐卖", /拐卖/], ["遗弃", /遗弃/], ["暴力伤害", /暴力|暴力伤害/], ["疏于照料", /忽视|疏于照料/], ["自伤风险", /自杀|自残/], ["组织乞讨", /乞讨/]].filter(([, pattern]) => pattern.test(value)).map(([label]) => label);
}
