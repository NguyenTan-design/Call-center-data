import pandas as pd
import json
import html

# ==========================
# Đọc Excel
# ==========================

df = pd.read_excel(
    r"C:\Users\quoct\OneDrive - Fuji Machine Asia Pte Ltd\CALL CENTER SUMMARY - DATA.xlsx"
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
        return value

    text = str(value)

    # Giải mã HTML Entity
    text = html.unescape(text)

    # Xóa _x000D_ và giữ nguyên xuống dòng
    text = text.replace("_x000D_", "")

    # Chuẩn hóa ký tự xuống dòng
    text = text.replace("\r\n", "\n")
    text = text.replace("\r", "\n")

    # Xóa khoảng trắng cuối mỗi dòng
    text = "\n".join(line.rstrip() for line in text.split("\n"))

    return text.strip()

# ==========================
# CLEAN DATA
# ==========================

for col in df.select_dtypes(include=["object"]).columns:
    df[col] = df[col].apply(clean_text)

# ==========================
# CONVERT TO DICTIONARY
# ==========================

data = df.to_dict(orient="records")

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