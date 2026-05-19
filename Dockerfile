FROM node:24-slim

ENV NODE_ENV=production
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY index.js gen_z_prompt.txt ./

RUN chown -R node:node /app
USER node

EXPOSE 9010

CMD ["node", "index.js"]
