FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./package.json
COPY server.js ./server.js
COPY public ./public
COPY data ./data
ENV PORT=3000
EXPOSE 3000
USER node
CMD ["node", "server.js"]
