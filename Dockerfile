FROM node:21-slim
WORKDIR /app
COPY . /app
RUN npm install
CMD npm start
