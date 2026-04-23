FROM node:20-alpine

# 设置工作目录
WORKDIR /app

# 复制 package.json 和 package-lock.json
COPY package*.json ./

# 安装依赖
RUN npm ci --omit=dev

# 复制所有源代码
COPY . .

# 暴露端口
EXPOSE 8080

# 启动服务
CMD ["node", "server.js"]
