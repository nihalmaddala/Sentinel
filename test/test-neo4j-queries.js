'use strict';
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const neo4j = require('neo4j-driver');

const driver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(process.env.NEO4J_USERNAME, process.env.NEO4J_PASSWORD)
);

async function run() {
  const session = driver.session({ defaultAccessMode: neo4j.session.READ });

  try {
    console.log('=== QUERY 1: DynamicPricing_v1 lineage ===');
    const r1 = await session.run(
      "MATCH (m:Model {name: 'DynamicPricing_v1'})-[:WRITES_TO|READS_FROM*1..5]->(db:Database)-[:CONTAINS]->(p:DataProperty) RETURN m.name AS model, db.name AS database, db.region AS region, p.name AS dataProperty, p.type AS dataType"
    );
    r1.records.forEach(function(r) {
      console.log('  ' + r.get('model') + ' -> ' + r.get('database') + ' [' + r.get('region') + '] -> ' + r.get('dataProperty') + ' (' + r.get('dataType') + ')');
    });
    console.log('  Total paths: ' + r1.records.length);

    console.log('\n=== QUERY 2: FaceMatch_v2 lineage ===');
    const r2 = await session.run(
      "MATCH (m:Model {name: 'FaceMatch_v2'})-[:WRITES_TO|READS_FROM*1..5]->(db:Database)-[:CONTAINS]->(p:DataProperty) RETURN m.name AS model, db.name AS database, db.region AS region, p.name AS dataProperty, p.type AS dataType"
    );
    r2.records.forEach(function(r) {
      console.log('  ' + r.get('model') + ' -> ' + r.get('database') + ' [' + r.get('region') + '] -> ' + r.get('dataProperty') + ' (' + r.get('dataType') + ')');
    });
    console.log('  Total paths: ' + r2.records.length);

    console.log('\n=== QUERY 3: California region risk scan ===');
    const r3 = await session.run(
      "MATCH (db:Database {region: 'California'})-[:CONTAINS]->(p:DataProperty) WHERE p.type IN ['Biometric', 'PII', 'Financial'] OPTIONAL MATCH (m:Model)-[:WRITES_TO|READS_FROM]->(db) RETURN db.name AS database, p.name AS dataProperty, p.type AS dataType, collect(m.name) AS connectedModels"
    );
    r3.records.forEach(function(r) {
      console.log('  ' + r.get('database') + ' -> ' + r.get('dataProperty') + ' (' + r.get('dataType') + ') | Models: ' + r.get('connectedModels').join(', '));
    });

    console.log('\n=== QUERY 4: Cross-region SYNCS_TO flows ===');
    const r4 = await session.run(
      "MATCH (src:Database)-[s:SYNCS_TO]->(dst:Database) RETURN src.name AS source, src.region AS srcRegion, dst.name AS dest, dst.region AS dstRegion, s.purpose AS purpose"
    );
    r4.records.forEach(function(r) {
      console.log('  ' + r.get('source') + ' [' + r.get('srcRegion') + '] --SYNCS_TO--> ' + r.get('dest') + ' [' + r.get('dstRegion') + '] (' + r.get('purpose') + ')');
    });

    console.log('\n=== GRAPH TOTALS ===');
    const nodes = await session.run('MATCH (n) RETURN labels(n)[0] AS label, count(n) AS cnt ORDER BY label');
    nodes.records.forEach(function(r) {
      var c = r.get('cnt');
      console.log('  ' + r.get('label') + ': ' + (typeof c.toNumber === 'function' ? c.toNumber() : c));
    });
    var rels = await session.run('MATCH ()-[r]->() RETURN type(r) AS rel, count(r) AS cnt ORDER BY rel');
    rels.records.forEach(function(r) {
      var c = r.get('cnt');
      console.log('  ' + r.get('rel') + ': ' + (typeof c.toNumber === 'function' ? c.toNumber() : c));
    });

    var totalNodes = await session.run('MATCH (n) RETURN count(n) AS total');
    var totalRels = await session.run('MATCH ()-[r]->() RETURN count(r) AS total');
    var tn = totalNodes.records[0].get('total');
    var tr = totalRels.records[0].get('total');
    console.log('\n  TOTAL: ' + (typeof tn.toNumber === 'function' ? tn.toNumber() : tn) + ' nodes, ' + (typeof tr.toNumber === 'function' ? tr.toNumber() : tr) + ' relationships');

  } finally {
    await session.close();
    await driver.close();
  }
}

run().catch(function(e) { console.error('ERROR:', e.message); process.exit(1); });
