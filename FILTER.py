import pandas as pd
import json

# Đọc Excel
df = pd.read_excel(
    r"D:\SOFTWARE\GIT HUB\Call-center-data\FILTER.xlsx"
)

# ===== NAT =====

NAT = (
    df["NAT"]
    .dropna()
    .tolist()
)

with open(
    "NAT.json",
    "w",
    encoding="utf-8"
) as f:

    json.dump(
        NAT,
        f,
        indent=4,
        ensure_ascii=False
    )

# ===== OTHER SITE =====

OTHER = (
    df["OTHER"]
    .dropna()
    .tolist()
)

with open(
    "OTHER.json",
    "w",
    encoding="utf-8"
) as f:

    json.dump(
        OTHER,
        f,
        indent=4,
        ensure_ascii=False
    )
print("DONE")