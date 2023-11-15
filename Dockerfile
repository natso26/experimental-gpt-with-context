FROM node:21-slim
COPY . /app
WORKDIR /app
ARG _ENV_PATH
RUN mv "$_ENV_PATH" .env && \
    npm install
CMD npm start
