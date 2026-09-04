# Read-only prototype: build the Vite bundle, then serve the static files with nginx.
# The app routes on the URL fragment (#/service?id=…), so the only paths nginx ever sees are / and
# /assets/*. The stock config already serves those, so there are no rewrite rules to add.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
# The build needs vite and tsc, so dev dependencies are installed whatever NODE_ENV the builder sets.
RUN npm install --include=dev
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
