@echo off
chcp 65001 > nul
title 货车调度系统 - 开发启动

echo.
echo ========================================
echo   货车司机调度管理系统 - 开发环境启动
echo ========================================
echo.

:: 检查 .env 是否存在
if not exist "backend\.env" (
    echo [!] backend\.env 未找到，正在从模板创建...
    copy "backend\.env.example" "backend\.env"
    echo [!] 请编辑 backend\.env 填写 Supabase 配置后重新运行
    pause
    exit /b
)

:: 安装依赖
echo [1/4] 安装后端依赖...
cd backend
call npm install --silent
cd ..

echo [2/4] 安装前端依赖...
cd frontend
call npm install --silent
cd ..

echo [3/4] 启动后端 (端口 3000)...
start "后端 NestJS" cmd /k "cd /d %~dp0backend && npm run start:dev"

timeout /t 3 > nul

echo [4/4] 启动前端 (端口 5173)...
start "前端 React" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo ========================================
echo   启动完成！
echo   前端: http://localhost:5173
echo   后端: http://localhost:3000
echo   API文档: http://localhost:3000/api/docs
echo
echo   默认账户: admin@trucksystem.com
echo   默认密码: Admin@123456
echo ========================================
echo.
pause
