-- Local-only seed used to test the production D1/API/UI path.
-- All names and relationships are fictional.

INSERT INTO entities (entity_type, canonical_name, slug, nzbn, company_number, status, metadata_json)
VALUES
('company','Kauri Signal Limited','kauri-signal-demo','9499999999999','DEMO-9001','Registered','{"demo":true}'),
('person','Aroha Te Rimu','aroha-te-rimu-demo',NULL,NULL,NULL,'{"demo":true}'),
('public_agency','Office of Digital Bridges','office-digital-bridges-demo',NULL,NULL,'Active','{"demo":true}');

INSERT INTO sources (dataset,publisher,record_id,source_url,retrieved_at,licence,importer_version)
VALUES
('DEMO Companies Register','NZ Connections prototype','DEMO-DIRECTOR-1','https://companies-register.companiesoffice.govt.nz/',CURRENT_TIMESTAMP,'Demonstration only','demo-v1'),
('DEMO Procurement','NZ Connections prototype','DEMO-CONTRACT-1','https://www.gets.govt.nz/',CURRENT_TIMESTAMP,'Demonstration only','demo-v1');

INSERT INTO relationships (subject_entity_id,predicate,object_entity_id,source_id,observed_at,metadata_json)
SELECT p.id,'DIRECTOR_OF',c.id,s.id,CURRENT_TIMESTAMP,'{"demo":true}'
FROM entities p, entities c, sources s
WHERE p.slug='aroha-te-rimu-demo' AND c.slug='kauri-signal-demo' AND s.record_id='DEMO-DIRECTOR-1';

INSERT INTO relationships (subject_entity_id,predicate,object_entity_id,source_id,observed_at,metadata_json)
SELECT a.id,'CONTRACTED_WITH',c.id,s.id,CURRENT_TIMESTAMP,'{"demo":true}'
FROM entities a, entities c, sources s
WHERE a.slug='office-digital-bridges-demo' AND c.slug='kauri-signal-demo' AND s.record_id='DEMO-CONTRACT-1';
