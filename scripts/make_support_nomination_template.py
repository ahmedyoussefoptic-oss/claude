# Builds public/files/support-nomination-template.xlsx — the form teachers
# fill to nominate students for the support programmes (remedial /
# enrichment). Read back by src/utils/supportNominationExcel.js; keep the
# header texts in step with HEADERS there.
#   python3 scripts/make_support_nomination_template.py
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.worksheet.datavalidation import DataValidation

OUT = "public/files/support-nomination-template.xlsx"
ROWS = 150
SUBJECTS = ["اللغة العربية", "اللغة الإنجليزية", "الرياضيات", "العلوم", "الفيزياء", "الكيمياء", "الأحياء",
            "التربية الإسلامية", "الدراسات الاجتماعية", "الحاسب الآلي", "اللغة الفرنسية"]
PROGRAMS = ["تقوية", "إثراء"]
# (header, width, hint)
COLS = [
    ("م", 5, ""),
    ("رقم الهوية / الإقامة", 20, "10 أرقام — إلزامي"),
    ("اسم الطالب", 30, ""),
    ("الصف", 9, "مثال: G5"),
    ("الفصل", 9, "مثال: 5-2"),
    ("البرنامج", 12, "تقوية / إثراء"),
    ("المادة", 20, "من القائمة"),
    ("سبب الترشيح", 42, "مثال: ضعف في القراءة"),
    ("اسم المعلم", 22, ""),
]

NAVY, SKY, AMBER = "1E3A5F", "E0F2FE", "FEF3C7"
thin = Side(style="thin", color="CBD5E1")
box = Border(left=thin, right=thin, top=thin, bottom=thin)
center = Alignment(horizontal="center", vertical="center", wrap_text=True)
right = Alignment(horizontal="right", vertical="center", wrap_text=True)

wb = Workbook()
ws = wb.active
ws.title = "الترشيح"
ws.sheet_view.rightToLeft = True
last = chr(ord("A") + len(COLS) - 1)

ws.merge_cells(f"A1:{last}1")
ws["A1"] = "نموذج ترشيح الطلاب لبرامج الدعم (تقوية / إثراء) — مدارس المكتشف العالمية"
ws["A1"].font = Font(bold=True, size=14, color="FFFFFF")
ws["A1"].fill = PatternFill("solid", fgColor=NAVY)
ws["A1"].alignment = center
ws.row_dimensions[1].height = 30

ws.merge_cells(f"A2:{last}2")
ws["A2"] = "الفرع: ................      المرحلة: ................      اسم المعلم: ................      التاريخ: ................"
ws["A2"].font = Font(size=11, color="334155")
ws["A2"].alignment = right
ws.row_dimensions[2].height = 24

HEAD = 3
for i, (h, w, hint) in enumerate(COLS, start=1):
    col = chr(ord("A") + i - 1)
    ws.column_dimensions[col].width = w
    c = ws.cell(row=HEAD, column=i, value=h)
    c.font = Font(bold=True, color=NAVY)
    c.fill = PatternFill("solid", fgColor=SKY)
    c.alignment = center
    c.border = box
    hc = ws.cell(row=HEAD + 1, column=i, value=hint)
    hc.font = Font(italic=True, size=9, color="64748B")
    hc.fill = PatternFill("solid", fgColor="F8FAFC")
    hc.alignment = center
    hc.border = box
ws.row_dimensions[HEAD].height = 26

first = HEAD + 2
for r in range(first, first + ROWS):
    for i in range(1, len(COLS) + 1):
        c = ws.cell(row=r, column=i)
        c.border = box
        c.alignment = center if i in (1, 2, 4, 5, 6) else right
    ws.cell(row=r, column=1, value=r - first + 1).font = Font(color="94A3B8")
    ws.cell(row=r, column=2).number_format = "@"  # keep leading digits as typed

# Lists on a hidden sheet, used by the drop-downs.
ls = wb.create_sheet("lists")
for i, p in enumerate(PROGRAMS, start=1):
    ls.cell(row=i, column=1, value=p)
for i, s in enumerate(SUBJECTS, start=1):
    ls.cell(row=i, column=2, value=s)
ls.sheet_state = "hidden"

end = first + ROWS - 1
dv_prog = DataValidation(type="list", formula1=f"=lists!$A$1:$A${len(PROGRAMS)}", allow_blank=True,
                         showErrorMessage=True, errorTitle="البرنامج", error="اختر: تقوية أو إثراء")
dv_prog.add(f"F{first}:F{end}")
# A subject off the list is allowed (a warning only) — e.g. two subjects.
dv_subj = DataValidation(type="list", formula1=f"=lists!$B$1:$B${len(SUBJECTS)}", allow_blank=True,
                         showErrorMessage=True, errorStyle="warning", errorTitle="المادة",
                         error="المادة ليست في القائمة. للمواد المتعددة افصل بينها بفاصلة.")
dv_subj.add(f"G{first}:G{end}")
dv_id = DataValidation(type="textLength", operator="equal", formula1="10", allow_blank=True,
                       showErrorMessage=True, errorStyle="warning", errorTitle="رقم الهوية",
                       error="رقم الهوية / الإقامة 10 أرقام.")
dv_id.add(f"B{first}:B{end}")
for dv in (dv_prog, dv_subj, dv_id):
    ws.add_data_validation(dv)

ws.freeze_panes = ws.cell(row=first, column=1)
ws.print_title_rows = f"{HEAD}:{HEAD}"
ws.page_setup.orientation = "landscape"
ws.page_setup.fitToWidth = 1
ws.page_setup.fitToHeight = 0
ws.sheet_properties.pageSetUpPr.fitToPage = True

# Instructions.
ins = wb.create_sheet("التعليمات", 1)
ins.sheet_view.rightToLeft = True
ins.column_dimensions["A"].width = 100
lines = [
    ("تعليمات تعبئة نموذج الترشيح", True),
    ("1. سجّل كل طالب في صف مستقل في ورقة «الترشيح».", False),
    ("2. رقم الهوية / الإقامة إلزامي (10 أرقام) — به يُتعرّف على الطالب في السجل، وباقي البيانات للمراجعة.", False),
    ("3. البرنامج: «تقوية» للطالب الذي يحتاج دعماً، و«إثراء» للطالب المتفوق.", False),
    ("4. المادة: اختر من القائمة. لأكثر من مادة اكتبها مفصولة بفاصلة (مثال: الرياضيات، العلوم).", False),
    ("5. سبب الترشيح: جملة قصيرة توضح احتياج الطالب.", False),
    ("6. لا تغيّر عناوين الأعمدة ولا ترتيبها. احفظ الملف وسلّمه للمنسق ليرفعه في النظام.", False),
]
for i, (text, bold) in enumerate(lines, start=1):
    c = ins.cell(row=i, column=1, value=text)
    c.font = Font(bold=bold, size=13 if bold else 11, color=NAVY if bold else "1E293B")
    c.alignment = right
    ins.row_dimensions[i].height = 26
ins["A1"].fill = PatternFill("solid", fgColor=AMBER)

wb.active = 0
wb.save(OUT)
print("wrote", OUT)
