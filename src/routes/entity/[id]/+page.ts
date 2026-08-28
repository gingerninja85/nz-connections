import { error } from '@sveltejs/kit';
import { getDemoConnections, getDemoEntity } from '$lib/demo';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
  const entity = getDemoEntity(params.id);
  if (!entity) error(404, 'Record not found');
  return { entity, connections: getDemoConnections(params.id) };
};