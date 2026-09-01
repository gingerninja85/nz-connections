import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

type D1DatabaseLike = { prepare: (query: string) => { bind: (...values: unknown[]) => { first: () => Promise<unknown>; all: () => Promise<{ results: unknown[] }> } } };
function isMissingGetsTableError(err: unknown) { const message=err instanceof Error?err.message:String(err); return /no such table:\s*gets_/i.test(message); }
async function getsFirst(db:D1DatabaseLike,query:string,...values:unknown[]){try{return await db.prepare(query).bind(...values).first();}catch(err){if(isMissingGetsTableError(err))return null;throw err;}}
async function getsAll(db:D1DatabaseLike,query:string,...values:unknown[]){try{return(await db.prepare(query).bind(...values).all()).results;}catch(err){if(isMissingGetsTableError(err))return[];throw err;}}

export const load: PageServerLoad = async ({params,platform}) => {
 if(!platform?.env?.DB) error(503,'Public-record database is not connected yet.');
 const id=Number(params.id); if(!Number.isInteger(id)||id<1) error(404,'Record not found'); const db=platform.env.DB;
 const entity=await db.prepare(`SELECT id,entity_type,canonical_name,slug,nzbn,company_number,status,metadata_json FROM entities WHERE id=?1`).bind(id).first(); if(!entity) error(404,'Record not found');
 const connections=await db.prepare(`
 SELECT r.id,r.predicate,r.valid_from,r.valid_to,r.observed_at,r.metadata_json AS relationship_metadata_json,
 CASE WHEN r.subject_entity_id=?1 THEN 'out' ELSE 'in' END AS direction,
 e.id AS connected_id,e.canonical_name AS connected_name,e.entity_type AS connected_type,e.status AS connected_status,e.slug AS connected_slug,e.metadata_json AS connected_metadata_json,
 gr.entity_id AS connected_gets_rfx_entity_id,gs.entity_id AS connected_gets_supplier_entity_id,
 COALESCE(gr.rfx_id,pr.rfx_id) AS graph_rfx_id,COALESCE(gr.title,pr.title) AS graph_rfx_title,COALESCE(gr.rfx_type,pr.rfx_type) AS graph_rfx_type,COALESCE(gr.competition_type,pr.competition_type) AS graph_competition_type,COALESCE(gr.posting_agency,pr.posting_agency) AS graph_posting_agency,COALESCE(gr.award_type,pr.award_type) AS graph_award_type,COALESCE(gr.awarded_amount_raw,pr.awarded_amount_raw) AS graph_awarded_amount_raw,
 COALESCE(gr.open_date,pr.open_date) AS graph_open_date,COALESCE(gr.close_date,pr.close_date) AS graph_close_date,COALESCE(gr.awarded_date,pr.awarded_date) AS graph_awarded_date,
 (SELECT group_concat(DISTINCT rr.region) FROM gets_rfx_regions rr WHERE rr.rfx_id=COALESCE(gr.rfx_id,pr.rfx_id)) AS graph_regions,
 (SELECT group_concat(DISTINCT rc.unspsc_description) FROM gets_rfx_unspsc_categories rc WHERE rc.rfx_id=COALESCE(gr.rfx_id,pr.rfx_id) AND trim(COALESCE(rc.unspsc_description,''))!='') AS graph_categories,
 (SELECT count(*) FROM gets_supplier_records sp WHERE sp.rfx_id=COALESCE(gr.rfx_id,pr.rfx_id)) AS graph_supplier_count,
 s.dataset,s.publisher,s.record_id,s.source_url,s.published_at,s.retrieved_at,s.licence
 FROM relationships r JOIN entities e ON e.id=CASE WHEN r.subject_entity_id=?1 THEN r.object_entity_id ELSE r.subject_entity_id END
 LEFT JOIN gets_rfx_records gr ON gr.entity_id=e.id LEFT JOIN gets_supplier_records gs ON gs.entity_id=e.id LEFT JOIN gets_rfx_records pr ON pr.rfx_id=gs.rfx_id JOIN sources s ON s.id=r.source_id
 WHERE r.subject_entity_id=?1 OR r.object_entity_id=?1 ORDER BY r.predicate,e.canonical_name LIMIT 250`).bind(id).all();
 const graphSecondHop=await db.prepare(`
 WITH direct AS (SELECT CASE WHEN r.subject_entity_id=?1 THEN r.object_entity_id ELSE r.subject_entity_id END AS entity_id,r.predicate,e.canonical_name FROM relationships r JOIN entities e ON e.id=CASE WHEN r.subject_entity_id=?1 THEN r.object_entity_id ELSE r.subject_entity_id END WHERE r.subject_entity_id=?1 OR r.object_entity_id=?1 ORDER BY r.predicate,e.canonical_name LIMIT 24)
 SELECT r.id,r.predicate,r.subject_entity_id AS subject_id,se.canonical_name AS subject_name,se.entity_type AS subject_type,r.object_entity_id AS object_id,oe.canonical_name AS object_name,oe.entity_type AS object_type,
 sgr.entity_id AS subject_gets_rfx_entity_id,sgs.entity_id AS subject_gets_supplier_entity_id,ogr.entity_id AS object_gets_rfx_entity_id,ogs.entity_id AS object_gets_supplier_entity_id,
 COALESCE(sgr.rfx_id,ogr.rfx_id,sgs.rfx_id,ogs.rfx_id) AS graph_rfx_id,COALESCE(sgr.title,ogr.title,pr.title) AS graph_rfx_title,COALESCE(sgr.rfx_type,ogr.rfx_type,pr.rfx_type) AS graph_rfx_type,COALESCE(sgr.competition_type,ogr.competition_type,pr.competition_type) AS graph_competition_type,COALESCE(sgr.posting_agency,ogr.posting_agency,pr.posting_agency) AS graph_posting_agency,COALESCE(sgr.award_type,ogr.award_type,pr.award_type) AS graph_award_type,COALESCE(sgr.awarded_amount_raw,ogr.awarded_amount_raw,pr.awarded_amount_raw) AS graph_awarded_amount_raw,
 (SELECT group_concat(DISTINCT rr.region) FROM gets_rfx_regions rr WHERE rr.rfx_id=COALESCE(sgr.rfx_id,ogr.rfx_id,sgs.rfx_id,ogs.rfx_id)) AS graph_regions,
 (SELECT group_concat(DISTINCT rc.unspsc_description) FROM gets_rfx_unspsc_categories rc WHERE rc.rfx_id=COALESCE(sgr.rfx_id,ogr.rfx_id,sgs.rfx_id,ogs.rfx_id) AND trim(COALESCE(rc.unspsc_description,''))!='') AS graph_categories,
 (SELECT count(*) FROM gets_supplier_records sp WHERE sp.rfx_id=COALESCE(sgr.rfx_id,ogr.rfx_id,sgs.rfx_id,ogs.rfx_id)) AS graph_supplier_count,s.dataset,s.publisher,s.record_id,s.source_url
 FROM relationships r JOIN direct d ON d.entity_id=r.subject_entity_id OR d.entity_id=r.object_entity_id JOIN entities se ON se.id=r.subject_entity_id JOIN entities oe ON oe.id=r.object_entity_id
 LEFT JOIN gets_rfx_records sgr ON sgr.entity_id=se.id LEFT JOIN gets_supplier_records sgs ON sgs.entity_id=se.id LEFT JOIN gets_rfx_records ogr ON ogr.entity_id=oe.id LEFT JOIN gets_supplier_records ogs ON ogs.entity_id=oe.id LEFT JOIN gets_rfx_records pr ON pr.rfx_id=COALESCE(sgs.rfx_id,ogs.rfx_id) JOIN sources s ON s.id=r.source_id
 WHERE r.subject_entity_id!=?1 AND r.object_entity_id!=?1 ORDER BY r.id LIMIT 180`).bind(id).all();
 const secondHopByDirect=new Map<number,unknown[]>(); for(const raw of graphSecondHop.results as Record<string,any>[]){for(const directId of[Number(raw.subject_id),Number(raw.object_id)]){if(!connections.results.some((c:any)=>Number(c.connected_id)===directId))continue;const bucket=secondHopByDirect.get(directId)??[];bucket.push(raw);secondHopByDirect.set(directId,bucket);}}
 let graphConnections=(connections.results as Record<string,any>[]).map(c=>({...c,graph_second_hop:secondHopByDirect.get(Number(c.connected_id))??[]}));
 const graphRfxIds=[...new Set(graphConnections.flatMap((c:any)=>[c.graph_rfx_id,...(c.graph_second_hop??[]).map((x:any)=>x.graph_rfx_id)]).map(String).filter(x=>/^\d+$/.test(x)))];
 const detailRows=graphRfxIds.length?await getsAll(db,`SELECT rfx_id,gets_url,overview_text,tender_name,tender_type_text,tender_coverage,outcome_text,fetched_at FROM gets_rfx_detail_enrichment WHERE rfx_id IN (${graphRfxIds.map(x=>`'${x}'`).join(',')})`):[];
 const detailMap=new Map((detailRows as any[]).map(d=>[String(d.rfx_id),d]));
 const addDetail=(x:any)=>({...x,...(detailMap.get(String(x.graph_rfx_id))?{graph_overview_text:detailMap.get(String(x.graph_rfx_id)).overview_text,graph_gets_url:detailMap.get(String(x.graph_rfx_id)).gets_url}: {})});
 graphConnections=graphConnections.map((c:any)=>({...addDetail(c),graph_second_hop:(c.graph_second_hop??[]).map(addDetail)}));
 const getsRfx=await getsFirst(db,`SELECT * FROM gets_rfx_records WHERE entity_id=?1`,id) as Record<string,any>|null;
 const getsSupplier=await getsFirst(db,`SELECT * FROM gets_supplier_records WHERE entity_id=?1`,id) as Record<string,any>|null;
 let getsRegions:unknown[]=[],getsCategories:unknown[]=[],getsSuppliers:unknown[]=[],getsRelatedRfx:unknown[]=[];let getsAgency=false,sourceEvidence:unknown=null,detail:unknown=null;
 if(getsRfx){getsRegions=await getsAll(db,`SELECT region FROM gets_rfx_regions WHERE rfx_id=?1 ORDER BY region`,getsRfx.rfx_id);getsCategories=await getsAll(db,`SELECT unspsc_code,unspsc_description FROM gets_rfx_unspsc_categories WHERE rfx_id=?1 ORDER BY unspsc_code,unspsc_description`,getsRfx.rfx_id);getsSuppliers=await getsAll(db,`SELECT g.business_name,g.nzbn_quality,g.raw_supplier_nzbn,e.id AS entity_id FROM gets_supplier_records g JOIN entities e ON e.id=g.entity_id WHERE g.rfx_id=?1 ORDER BY g.row_ordinal_for_rfx`,getsRfx.rfx_id);detail=await getsFirst(db,`SELECT * FROM gets_rfx_detail_enrichment WHERE rfx_id=?1`,getsRfx.rfx_id);sourceEvidence=await getsFirst(db,`SELECT s.dataset,s.publisher,s.record_id,s.source_url,s.published_at,s.retrieved_at,s.licence FROM relationships r JOIN sources s ON s.id=r.source_id WHERE r.subject_entity_id=?1 OR r.object_entity_id=?1 ORDER BY s.retrieved_at DESC LIMIT 1`,id);}
 if(getsSupplier){getsRelatedRfx=await getsAll(db,`SELECT g.rfx_id,g.title,g.award_type,e.id AS entity_id FROM gets_rfx_records g JOIN entities e ON e.id=g.entity_id WHERE g.rfx_id=?1`,getsSupplier.rfx_id);sourceEvidence=await getsFirst(db,`SELECT s.dataset,s.publisher,s.record_id,s.source_url,s.published_at,s.retrieved_at,s.licence FROM relationships r JOIN sources s ON s.id=r.source_id WHERE r.subject_entity_id=?1 OR r.object_entity_id=?1 ORDER BY s.retrieved_at DESC LIMIT 1`,id);}
 getsAgency=!!(await getsFirst(db,`SELECT 1 FROM gets_rfx_records WHERE agency_entity_id=?1 LIMIT 1`,id));
 return{entity,connections:graphConnections,gets:{rfx:getsRfx,supplier:getsSupplier,regions:getsRegions,categories:getsCategories,suppliers:getsSuppliers,relatedRfx:getsRelatedRfx,agency:getsAgency,sourceEvidence,detail}};
};