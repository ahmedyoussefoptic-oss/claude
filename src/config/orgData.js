// Fallback org data used until the `branches`/`departments` Firestore
// collections are seeded, or if a read from them fails.
export const BRANCHES = [
  { id: 'DOWN_TOWN_BOYS', name: 'فرع الداون تاون بنين' },
  { id: 'DOWN_TOWN_GIRLS', name: 'فرع الداون تاون بنات' },
  { id: 'AL_SHATI', name: 'فرع الشاطئ' },
  { id: 'AL_MOHAMMADIA', name: 'فرع المحمدية' },
  { id: 'AL_SALAMA_GIRLS', name: 'فرع السلامة بنات' },
  { id: 'AL_SALAMA_BOYS', name: 'فرع السلامة بنين' },
  { id: 'AL_NAEEM', name: 'فرع النعيم' },
  { id: 'AL_ZAHRA', name: 'فرع الزهراء' },
];

export const DEPARTMENTS = [
  { id: 'AMERICAN', name: 'القسم الأمريكي' },
  { id: 'BRITISH', name: 'القسم البريطاني' },
  { id: 'SPECIAL_EDUCATION', name: 'قسم التربية الخاصة' },
];
