type Domain = 'mathematics' | 'physics';
interface Field { label: string; path: string; domains: readonly Domain[]; aliases: readonly string[] }
/** Shared scientific field catalog. Catalog order breaks compatible specialization ties;
 * it is not a scientific ranking. No title/body classification or semantic edges. */
export const FIELD_CATALOG = {
  "mathematical-physics": {"label": "Mathematical physics", "domains": ["mathematics", "physics"], "aliases": ["mathematical-physics", "数学物理"], "path": "M16 5H8l5 7-5 7h8M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0"},
  "optimization": {"label": "Optimization", "domains": ["mathematics"], "aliases": ["optimization", "convex-optimization", "quadratic-optimization", "linear-programming", "nonlinear-optimization", "优化"], "path": "M3 6h18M3 12h18M3 18h18M8 3v6M16 9v6M10 15v6"},
  "numerical": {"label": "Numerical analysis", "domains": ["mathematics"], "aliases": ["numerical-analysis", "numerical-methods", "numerical-computation", "数值分析"], "path": "M3 3v18h18M5 17l4-8 5 4 6-9M8 8h2v2H8ZM13 12h2v2h-2ZM19 3h2v2h-2Z"},
  "control": {"label": "Control theory", "domains": ["mathematics", "physics"], "aliases": ["control-theory", "optimal-control", "控制理论"], "path": "M8 5h8v6H8ZM8 8H3v11h18V8h-5M11 17l2 2-2 2"},
  "dynamics": {"label": "Dynamical systems", "domains": ["mathematics", "physics"], "aliases": ["dynamical-systems", "nonlinear-dynamics", "chaos-theory", "动力系统"], "path": "M3 12c4-12 4 12 9 0s5 12 9 0M3 21h18M3 21V3"},
  "discrete": {"label": "Discrete mathematics", "domains": ["mathematics"], "aliases": ["discrete-mathematics", "graph-theory", "network-theory", "network-energy", "combinatorics", "离散数学", "图论"], "path": "M12 5 5 18M12 5l7 13M5 18h14M15 4a3 3 0 1 1-6 0 3 3 0 0 1 6 0M8 19a3 3 0 1 1-6 0 3 3 0 0 1 6 0M22 19a3 3 0 1 1-6 0 3 3 0 0 1 6 0"},
  "statistics": {"label": "Probability & statistics", "domains": ["mathematics"], "aliases": ["statistics", "probability", "probability-theory", "stochastic-processes", "统计学", "概率论"], "path": "M4 20v-7h4v7M10 20V8h4v12M16 20V3h4v17M2 21h20"},
  "algebra": {"label": "Algebra", "domains": ["mathematics"], "aliases": ["algebra", "linear-algebra", "abstract-algebra", "quadratic-forms", "代数", "线性代数"], "path": "M5 5h14M5 19h14M8 3 5 21M19 3l-3 18M3 9h18M3 15h18"},
  "geometry": {"label": "Geometry & topology", "domains": ["mathematics"], "aliases": ["geometry", "topology", "differential-geometry", "algebraic-topology", "几何", "拓扑"], "path": "M12 3 3 20h18L12 3ZM7 13h10"},
  "analysis": {"label": "Analysis", "domains": ["mathematics"], "aliases": ["analysis", "calculus", "real-analysis", "complex-analysis", "functional-analysis", "differential-equations", "分析", "微积分"], "path": "M3 18c5 0 3-12 8-12s3 12 10 12M3 21V3M3 21h18"},
  "optics": {"label": "Optics", "domains": ["physics"], "aliases": ["optics", "geometrical-optics", "physical-optics", "photonics", "光学"], "path": "M12 3c-5 5-5 13 0 18 5-5 5-13 0-18ZM2 5l20 14M2 12h20M2 19 22 5"},
  "fluids": {"label": "Fluid mechanics", "domains": ["physics"], "aliases": ["fluid-mechanics", "fluid-dynamics", "hydrodynamics", "aerodynamics", "流体力学"], "path": "M2 5h7c5 0 3 5 8 5h5M2 12h6c5 0 4 5 9 5h5M2 19h6M19 7l3 3-3 3M19 14l3 3-3 3"},
  "condensed": {"label": "Condensed matter", "domains": ["physics"], "aliases": ["condensed-matter", "condensed-matter-physics", "solid-state-physics", "凝聚态物理"], "path": "M5 5h14v14H5ZM5 12h14M12 5v14M3 3h4v4H3ZM17 3h4v4h-4ZM3 17h4v4H3ZM17 17h4v4h-4ZM10 10h4v4h-4Z"},
  "particle": {"label": "Particle physics", "domains": ["physics"], "aliases": ["particle-physics", "high-energy-physics", "粒子物理"], "path": "M3 3l8 8M3 21l8-8M13 11l8-8M13 13c9 0 0 8 8 8M14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0"},
  "quantum": {"label": "Quantum physics", "domains": ["physics"], "aliases": ["quantum-physics", "qm", "quantum-mechanics", "quantum-field-theory", "quantum-information", "量子物理", "量子力学"], "path": "M2 12c4-13 6 13 10 0s6 13 10 0M12 3v18M8 5h8M8 19h8"},
  "relativity": {"label": "Relativity", "domains": ["physics"], "aliases": ["relativity", "general-relativity", "special-relativity", "相对论"], "path": "M3 4c6 4 12 4 18 0M3 12h18M3 20c6-4 12-4 18 0M4 3c4 6 4 12 0 18M12 3v18M20 3c-4 6-4 12 0 18"},
  "thermodynamics": {"label": "Thermal & statistical physics", "domains": ["physics"], "aliases": ["thermodynamics", "statistical-mechanics", "statistical-physics", "thermal-physics", "热力学", "统计力学"], "path": "M10 4a2 2 0 0 1 4 0v10a4 4 0 1 1-4 0V4ZM12 8v10M17 5h4M17 9h3"},
  "electromagnetism": {"label": "Electromagnetism", "domains": ["physics"], "aliases": ["electromagnetism", "em", "electromagnetic-fields", "electrodynamics", "electrostatics", "magnetism", "电磁学"], "path": "M4 3v10a8 8 0 0 0 16 0V3h-5v10a3 3 0 0 1-6 0V3H4ZM4 7h5M15 7h5"},
  "astronomy": {"label": "Astronomy", "domains": ["physics"], "aliases": ["astronomy", "astrophysics", "cosmology", "天文学", "天体物理", "宇宙学"], "path": "M12 3v3M12 18v3M3 12h3M18 12h3M6 6l2 2M16 16l2 2M6 18l2-2M16 8l2-2M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0"},
  "mechanics": {"label": "Mechanics", "domains": ["physics"], "aliases": ["mechanics", "cm", "classical-mechanics", "analytical-mechanics", "hamiltonian-mechanics", "lagrangian-mechanics", "力学", "经典力学"], "path": "M5 3h14M12 3v4M12 7l5 10M20 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0M6 16l2 2M5 20l2 1"},
  "mathematics": {"label": "Mathematics", "domains": ["mathematics"], "aliases": ["mathematics", "math", "数学"], "path": "M17 4H6l7 8-7 8h11"},
  "physics": {"label": "Physics", "domains": ["physics"], "aliases": ["physics", "物理", "物理学"], "path": "M12 3c-3 0-3 18 0 18s3-18 0-18ZM4 7c-2 3 14 12 16 9S6 4 4 7ZM4 16c2 3 18-6 16-9S2 13 4 16ZM12 12h.01"},
  "interdisciplinary": {"label": "Interdisciplinary", "domains": [], "aliases": ["interdisciplinary"], "path": "M15 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0ZM21 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0"},
  "general": {"label": "General", "domains": [], "aliases": ["general"], "path": "M4 5c3-1 5-1 8 1 3-2 5-2 8-1v14c-3-1-5-1-8 1-3-2-5-2-8-1V5ZM12 6v14"}
} as const satisfies Record<string, Field>;

export type FieldId = keyof typeof FIELD_CATALOG;
const ids = Object.keys(FIELD_CATALOG) as FieldId[];
const normalize = (value: string) => value.normalize('NFKC').trim().toLowerCase().replace(/[\s_]+/gu, '-');
const aliases = new Map(ids.flatMap(id => FIELD_CATALOG[id].aliases.map(alias => [normalize(alias), id] as const)));
/** Resolve explicit field metadata without guessing from a node's prose. */
export function canonicalFieldId(value:string):FieldId|undefined {
  const key=normalize(value.replace(/^(subject|specialization):/i,''));
  return Object.hasOwn(FIELD_CATALOG,key)?key as FieldId:aliases.get(key);
}
const specializations=ids.filter(id=>!['general','interdisciplinary','mathematics','physics'].includes(id));
export const FIELD_TAG_GUIDANCE='Use subject:physics or subject:mathematics as applicable. Choose specialization:<field> from '+specializations.join(', ')+'. Omit the specialization when none fits.';
const domains = (id: FieldId): readonly Domain[] => FIELD_CATALOG[id].domains;
/** Exactly one field from explicit metadata; duplicate aliases and tag order are immaterial. */
export function classifyField(tags: readonly string[] = []): FieldId {
  const subjects = new Set<FieldId>(), specializations = new Set<FieldId>(), unsupportedSubjects = new Set<string>();
  for (const tag of tags) {
    const split = tag.indexOf(':'); if (split < 0) continue;
    const kind = tag.slice(0, split).trim().toLowerCase(), id = canonicalFieldId(tag.slice(split + 1));
    if (kind === 'subject' && !id && tag.slice(split + 1).trim()) unsupportedSubjects.add(normalize(tag.slice(split + 1)));
    if (id && kind === 'subject') subjects.add(id);
    if (id && kind === 'specialization') specializations.add(id);
  }
  const declared = [...subjects].filter(id => domains(id).length);
  if (unsupportedSubjects.size) return declared.length || subjects.has('interdisciplinary') ? 'interdisciplinary' : 'general';
  const common = (entries: FieldId[]) => (['mathematics','physics'] as Domain[]).filter(domain => entries.every(id => domains(id).includes(domain)));
  const shared = common(declared);
  if (declared.length && !shared.length) {
    // A named bridge may cover both fields; graph proximity never creates one.
    return specializations.has('mathematical-physics') || subjects.has('mathematical-physics') ? 'mathematical-physics' : 'interdisciplinary';
  }
  const broad = (id: FieldId) => id === 'mathematics' || id === 'physics';
  const compatible = ids.filter(id => specializations.has(id) && domains(id).length && (!declared.length || domains(id).some(domain => shared.includes(domain))));
  const specific = compatible.filter(id => !broad(id));
  if (specific.length) return common(specific).length ? specific[0]! : 'interdisciplinary';
  const subject = ids.find(id => subjects.has(id) && domains(id).length);
  return subject ?? compatible[0] ?? (subjects.has('interdisciplinary') || specializations.has('interdisciplinary') ? 'interdisciplinary' : 'general');
}
