import pandas as pd
import json

# Đọc Excel
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
# CLEAN DATA
# ==========================

# Xử lý tất cả các cột kiểu text
for col in df.select_dtypes(include=["object"]).columns:

    df[col] = (
        df[col]
        .fillna("")
        .astype(str)
        .str.replace("_x000D_", "\n", regex=False)   # hoặc " " nếu không muốn xuống dòng
        .str.replace("\r\n", "\n", regex=False)
        .str.replace("\r", "\n", regex=False)
        .str.strip()
    )

# Nếu muốn xóa hoàn toàn xuống dòng:
# df[col] = df[col].str.replace("\n", " ", regex=False)

# ==========================
# CONVERT JSON
# ==========================

data = json.loads(
    df.to_json(
        orient="records",
        force_ascii=False
    )
)

# Xuất JSON
with open("data.json", "w", encoding="utf-8") as f:
    json.dump(
        data,
        f,
        ensure_ascii=False,
        indent=4
    )

print("DONE")