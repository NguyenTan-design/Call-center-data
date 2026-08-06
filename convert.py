import pandas as pd
import json
import html
import re

# ==========================
# Đọc Excel
# ==========================

df = pd.read_excel(
    r"C:\Users\quoct\OneDrive - Fuji Machine Asia Pte Ltd\CALL CENTER SUMMARY.xlsx"
)

# Chỉ lấy các cột cần
df = df[
    [
        "DATE",
        "CC NUMBER",
        "Customer",
        "TOPIC",
        "Communication Content",
        "FMV PIC",
        "GO TO WEB"
    ]
]

# ==========================
# CLEAN FUNCTION
# ==========================

def clean_text(value):

    if pd.isna(value):
        return ""

    text = str(value)

    # Giải mã HTML Entity
    text = html.unescape(text)

    # Xóa ký tự _x000D_
    text = text.replace("_x000D_", "\n")

    # Chuẩn hóa xuống dòng
    text = text.replace("\r\n", "\n")
    text = text.replace("\r", "\n")

    # Xóa khoảng trắng cuối dòng
    text = re.sub(r"[ \t]+\n", "\n", text)

    # Gộp nhiều dòng trống liên tiếp
    text = re.sub(r"\n{3,}", "\n\n", text)

    # Xóa khoảng trắng đầu/cuối
    text = text.strip()

    return text

# ==========================
# CLEAN DATA
# ==========================

for col in df.columns:
    df[col] = df[col].apply(clean_text)

# ==========================
# CONVERT TO JSON
# ==========================

data = json.loads(
    df.to_json(
        orient="records",
        force_ascii=False
    )
)

# ==========================
# SAVE JSON
# ==========================

with open("data.json", "w", encoding="utf-8") as f:
    json.dump(
        data,
        f,
        ensure_ascii=False,
        indent=4
    )

print("DONE")