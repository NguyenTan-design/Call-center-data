import pandas as pd
import json

# Đọc Excel
df = pd.read_excel(r"C:\Users\quoct\OneDrive - Fuji Machine Asia Pte Ltd\CALL CENTER SUMMARY - DATA.xlsx")

# Chỉ lấy các cột cần
df = df[["DATE", "CC NUMBER", "Customer", "TOPIC", "Communication Content", "FMV PIC", "GO TO WEB"]]


# Convert JSON
data = json.loads(df.to_json(orient="records", force_ascii=False))
# Xuất JSON
with open("data.json", "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=4)

print("DONE")