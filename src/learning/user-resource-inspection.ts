/** USER navigation only. No model exposure, learning publication, or inferred relation. */
import { validateNetworkPublicationV3, type NetworkPublicationV3, type RouteTemplateV3, type MethodLinkV3 } from './method-network-v3.js';
import type { ResourceRef } from './research-data.js';

export interface UserResourceNetwork {
  routes: Pick<RouteTemplateV3, 'id' | 'version' | 'resourceRef' | 'title' | 'transformation'>[];
  links: Pick<MethodLinkV3, 'id' | 'version' | 'from' | 'to' | 'relation' | 'basis' | 'bridgeConditions'>[];
}
const key = (ref: ResourceRef) => JSON.stringify([ref.id, ref.version]);
export function userResourceNetwork(publication: NetworkPublicationV3 | undefined, available: (ref: ResourceRef) => boolean): UserResourceNetwork {
  if (!publication) return { routes: [], links: [] };
  validateNetworkPublicationV3(publication);
  const routes = publication.routes.filter(route => route.status === 'active'
    && [route.resourceRef, ...route.sourceRefs, ...route.alternatives].every(available));
  const current = new Set(routes.map(key));
  return structuredClone({
    routes: routes.map(({ id, version, resourceRef, title, transformation }) => ({ id, version, resourceRef, title, transformation })),
    links: publication.links.filter(link => current.has(key(link.from)) && current.has(key(link.to)) && link.sourceRefs.every(available))
      .map(({ id, version, from, to, relation, basis, bridgeConditions }) => ({ id, version, from, to, relation, basis, bridgeConditions })),
  });
}
