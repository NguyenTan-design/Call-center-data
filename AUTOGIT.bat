@echo off

cd /d "D:\GIT HUB\Call-center-data"

python convert.py

git pull origin main

git add .

git diff --cached --quiet
if %errorlevel%==0 exit

git commit -m "Auto Update"

git push origin main