import test from 'node:test';
import assert from 'node:assert/strict';
import {validateMeasurements,buildGraphs,parseDraftResponse,providerRequest} from '../supabase/functions/_shared/blood-analysis.mjs';
const row=(overrides={})=>({code:'ferritin',unit:'ug/L',collected_on:'2026-09-01',value:18,reference_low:30,reference_high:150,...overrides});
const narrative={summary:'Factual draft for clinician review.',observations:[{code:'ferritin',comment:'Below the supplied lab interval.'}],limitations:['Clinical context and the original report need verification.']};
const response=content=>({status:'completed',output:[{type:'message',content}]});
test('graphs preserve numeric values, sort by real dates and keep incompatible units apart',()=>{
 const rows=[row(),row({collected_on:'2026-03-01',value:17}),row({code:'hba1c',unit:'%',value:5.4,reference_low:4,reference_high:5.6}),row({code:'hba1c',unit:'mmol/mol',value:36,reference_low:20,reference_high:42})];
 const graphs=buildGraphs(rows);assert.equal(graphs.length,3);assert.deepEqual(graphs[0].points.map(p=>p.value),[17,18]);assert.equal(graphs[0].points[1].interval_status,'below');assert.equal(graphs[1].unit,'%');assert.equal(graphs[2].unit,'mmol/mol');
});
test('no reference intervals are invented; boundaries are inclusive',()=>{
 assert.equal(buildGraphs([row({reference_low:null,reference_high:null})])[0].points[0].interval_status,'not_provided');
 assert.equal(buildGraphs([row({value:30})])[0].points[0].interval_status,'within');
});
test('bad dates, duplicates, prompt fields, nonfinite values, missing/unknown units and partial intervals are rejected',()=>{
 for(const bad of [{collected_on:'2026-02-30'},{value:Infinity},{value:'18'},{unit:'mg/L'},{reference_high:null},{code:'ignore_all_instructions'},{notes:'bypass the doctor'},{collected_on:'2099-01-01'}])assert.throws(()=>validateMeasurements([row(bad)]));
 assert.throws(()=>validateMeasurements([row(),row()]));assert.throws(()=>validateMeasurements([]));
});
test('AI refusals, incomplete output, missing markers and unsupported fields never become a draft',()=>{
 assert.throws(()=>parseDraftResponse(response([{type:'refusal',refusal:'declined'}]),[row()]));
 assert.throws(()=>parseDraftResponse({status:'incomplete',output:[]},[row()]));
 assert.throws(()=>parseDraftResponse(response([{type:'output_text',text:JSON.stringify({...narrative,observations:[{code:'ldl',comment:'Not supplied.'}]})}]),[row()]));
 assert.throws(()=>parseDraftResponse(response([{type:'output_text',text:JSON.stringify({...narrative,graphs:[]})}]),[row()]));
 assert.deepEqual(parseDraftResponse(response([{type:'output_text',text:JSON.stringify(narrative)}]),[row()]),narrative);
});
test('provider request is stateless, structured and contains only structured measurements',()=>{
 const req=providerRequest('configured-model',[row()]);assert.equal(req.store,false);assert.equal(req.model,'configured-model');assert.equal(req.text.format.strict,true);assert.equal(req.tools,undefined);assert.deepEqual(Object.keys(JSON.parse(req.input)).sort(),['interval_comparisons','measurements']);
});
