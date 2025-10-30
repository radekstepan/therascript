# @therascript/elasticsearch-manager — Developer Notes

Purpose: Ensure the Elasticsearch Docker service is running and healthy using shared docker-utils.

## Key files
- Entrypoint: `src/index.ts`
- Uses: `@therascript/docker-utils` `ensureServiceReady`

## Build/Run
- Build: `yarn build`
- Start: `yarn start`

## Behavior
- Starts service via compose and polls health (HTTP to 127.0.0.1:9200)

## Gotchas
- Requires Docker daemon; logs advise on checking container logs when health checks fail