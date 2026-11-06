import type {ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs} from "react-router";
import {Form, Link, useActionData, useLoaderData, useNavigation} from "react-router";
import {boundary} from "@shopify/shopify-app-react-router/server";
import {authenticate} from "../shopify.server";
import {loadMerchantConfig} from "../lib/merchant-config.server";
import {AGENTS,STATUS_LABELS} from "../lib/agent-registry";
import {resolveSwarmEntitlement} from "../lib/swarm-billing.server";
import {loadSwarmTeam,resizeSwarmRole,queueSwarmResearch} from "../lib/swarm-roster.server";
import {SWARM_PLANS,SwarmPolicyError,requiredSkeptics} from "../lib/swarm-policy";

export const loader=async ({request}:LoaderFunctionArgs)=>{
  const {admin,session}=await authenticate.admin(request);
  const config=await loadMerchantConfig(session.shop,session.id);
  if(!config)throw new Response("Merchant disconnected.",{status:401});
  const [plan,team]=await Promise.all([
    resolveSwarmEntitlement(admin),loadSwarmTeam(session.shop)
  ]);
  return {shop:session.shop,plan,planDetails:SWARM_PLANS[plan],team,
    billingLive:process.env.SWARM_BILLING_ENABLED==="true",
    workerLive:process.env.SWARM_EXECUTION_ENABLED==="true"};
};

export const action=async ({request}:ActionFunctionArgs)=>{
  const {admin,session}=await authenticate.admin(request);
  if(!(await loadMerchantConfig(session.shop,session.id))){
    return {ok:false,message:"Merchant session is no longer active."};
  }
  const form=await request.formData();
  const intent=form.get("intent");
  const plan=await resolveSwarmEntitlement(admin);
  try{
    if(intent==="set_slots"){
      const text=form.get("desired");
      if(typeof text!=="string"||!/^(?:0|[1-9][0-9]?)$/.test(text)){
        return {ok:false,message:"Enter a whole number of specialists from 0 to 50."};
      }
      const role=form.get("role");
      if(typeof role!=="string")return {ok:false,message:"Invalid role."};
      const value=await resizeSwarmRole({
        shop:session.shop,sessionId:session.id,role,
        desired:Number(text),plan
      });
      return {ok:true,message:
        "Team saved: "+value.specialists+" specialist(s), "+value.skeptics+
        " independent skeptic(s). No model calls or store changes were made."};
    }
    if(intent==="queue_case"){
      const role=form.get("role");
      if(typeof role!=="string")return {ok:false,message:"Choose a valid role."};
      const result=await queueSwarmResearch({
        shop:session.shop,sessionId:session.id,role,plan,
        title:form.get("title"),hypothesis:form.get("hypothesis"),
        metric:form.get("metric"),rejectionRule:form.get("rejectionRule")
      });
      return {ok:true,message:
        "Research brief queued for "+result.recipients+
        " assigned workers. This is an inbox only; AI execution is not enabled."};
    }
    return {ok:false,message:"Unsupported team action."};
  }catch(error){
    if(error instanceof SwarmPolicyError)return {ok:false,message:error.message};
    console.warn("Swarm team action failed",error instanceof Error?error.name:"unknown");
    return {ok:false,message:"Could not update the team. Please retry after checking the installation."};
  }
};

const panelStyle={border:"1px solid #dde2e8",borderRadius:12,padding:16,background:"#fff"} as const;
const inputStyle={width:"100%",padding:"8px 10px",border:"1px solid #aab4bf",
  borderRadius:6,background:"#fff",marginTop:5,boxSizing:"border-box"} as const;

export default function Team(){
  const {shop,plan,planDetails,team,billingLive,workerLive}=useLoaderData<typeof loader>();
  const outcome=useActionData<typeof action>();
  const nav=useNavigation();
  const busy=nav.state!=="idle";
  const count=team.participants.totalSpecialists;
  const skeptical=team.participants.totalSkeptics;
  const overLimit=count>planDetails.specialistSlots;
  const labels=new Map(team.agents.map(a=>[a.id,a.label]));
  const executionByCase=new Map(team.runs.map(run=>[run.caseId,run]));
  const recentUsage=team.usage[0];
  return <s-page heading="AI Team · Swarm Control Plane">
    <s-section heading="Your team and subscription guardrails">
      <p><strong>{shop}</strong> · Entitlement: <strong>{plan.toUpperCase()}</strong></p>
      <p>{count} of {planDetails.specialistSlots} specialist slots allocated · {skeptical} independent skeptics assigned ·
        {planDetails.researchCredits} proposed monthly research credits.</p>
      {recentUsage&&<p><strong>Worker test meter ({recentUsage.month}):</strong> {recentUsage.consumed} model attempts consumed · {recentUsage.reserved} reserved.
        Uncertain attempts are never automatically refunded. This is a request-count safety meter, not verified dollar spend.</p>}
      <p>One skeptic per five specialists <strong>within each role</strong>, rounded up.
        Skeptics do not consume specialist slots. Every claim needs evidence, a measurable
        success criterion and a rejection rule before it can be recommended.</p>
      {!billingLive&&<p role="status">Paid swarm billing is not active. Until authenticated Shopify
        subscriptions are enabled and verified, the free allocation is enforced. No charges are created here.</p>}
      {!workerLive&&<p role="status">Agent execution is not connected yet. Configurations and research
        briefs are stored; no AI agents are currently deliberating or changing the shop.</p>}
      {overLimit&&<p role="alert">This roster exceeds the current verified plan. Reduce specialist
        allocations before queuing research. Existing assignments are preserved for review.</p>}
      {outcome&&<p role="status"><strong>{outcome.ok?"Saved":"Attention"}:</strong> {outcome.message}</p>}
      <p><Link to="/app/manager">Review approvals</Link> · <Link to="/app/seo">SEO intelligence</Link></p>
    </s-section>
    <s-section heading="Configure specialists by role">
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:14}}>
        {AGENTS.map(agent=>{
          const current=team.participants.roles[agent.id]?.specialists??0;
          const critics=team.participants.roles[agent.id]?.skeptics??0;
          return <section key={agent.id} style={panelStyle}>
            <h3 style={{fontSize:17,margin:"0 0 6px"}}>{agent.name}</h3>
            <p style={{fontSize:12,margin:"0 0 10px",color:"#555"}}>
              {agent.domain} · {STATUS_LABELS[agent.status]}</p>
            <p style={{margin:"0 0 10px"}}>{agent.purpose}</p>
            <p><strong>{current} specialists · {critics} skeptics</strong></p>
            {current>0&&<details style={{marginBottom:12}}>
              <summary>Research assignments</summary>
              <ul>{team.agents.filter(worker=>worker.role===agent.id).map(worker=>
                <li key={worker.id}><strong>{worker.kind==="skeptic"?"Skeptic":"Specialist"}:</strong>
                  {" "+worker.specialty}</li>)}</ul>
              <small>Distinct research lanes encourage independent work; they are not
                evidence that an idea is novel or profitable.</small>
            </details>}
            <Form method="post" style={{display:"flex",alignItems:"end",gap:8,flexWrap:"wrap"}}>
              <input type="hidden" name="intent" value="set_slots"/>
              <input type="hidden" name="role" value={agent.id}/>
              <label style={{flex:"1 1 90px",fontSize:13}}>
                Specialist slots
                <input style={inputStyle} aria-label={agent.name+" specialist slots"}
                  type="number" name="desired" min="0" max="50" step="1"
                  defaultValue={current} key={agent.id+":"+current} required/>
              </label>
              <button type="submit" disabled={busy} style={{padding:"8px 12px",
                borderRadius:6,border:"1px solid #4e6070",background:"#f7f9fb",
                cursor:"pointer"}}>Save</button>
            </Form>
            <small>At 5 specialists: 1 skeptic. At 6: 2 skeptics. Each is a
              persistent slot, not a paid model call.</small>
          </section>;
        })}
      </div>
    </s-section>
    <s-section heading="Open a falsifiable research case">
      <p>Create a structured, shop-isolated research brief. The server creates separate
        inbox messages for every specialist and assigned skeptic, ready for future
        credit-metered worker execution. It does not invent AI responses.</p>
      <Form method="post" style={{display:"grid",gap:12,maxWidth:780}}>
        <input type="hidden" name="intent" value="queue_case"/>
        <label>Role
          <select name="role" required style={inputStyle}>
            {AGENTS.filter(a=>(team.participants.roles[a.id]?.specialists??0)>0)
              .map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label>Problem statement
          <input style={inputStyle} name="title" maxLength={140} minLength={8}
            placeholder="Find evidence for missed long-tail search intent" required/>
        </label>
        <label>Testable hypothesis
          <textarea name="hypothesis" style={{...inputStyle,minHeight:68}} maxLength={1200}
            placeholder="A specific, alternative explanation for a measured performance gap..." required/>
        </label>
        <label>Success metric and baseline
          <textarea name="metric" style={{...inputStyle,minHeight:65}} maxLength={600}
            placeholder="Observed clicks per eligible URL versus pre-registered comparable controls..." required/>
        </label>
        <label>Rejection rule
          <textarea name="rejectionRule" style={{...inputStyle,minHeight:65}} maxLength={600}
            placeholder="Reject if held-out improvement is absent or negative after costs..." required/>
        </label>
        <button type="submit" disabled={busy||count===0||overLimit}
          style={{padding:"10px 12px",borderRadius:6,border:"1px solid #405468",
            background:"#f1f5f9",maxWidth:260}}>Queue research brief</button>
      </Form>
    </s-section>
    <s-section heading="Research ledger · evidence before conclusions">
      {!team.cases.length&&<p>No research cases yet. The team is configurable,
        but workers will not execute until an approved provider, durable queue,
        authenticated worker identity and credit metering are connected.</p>}
      <div style={{display:"grid",gap:12}}>
        {team.cases.map(item=>{
          const notes=team.messages.filter(m=>m.caseId===item.id);
          const execution=executionByCase.get(item.id);
          return <article key={item.id} style={panelStyle}>
            <h3 style={{margin:"0 0 8px",fontSize:16}}>{item.title}</h3>
            <p style={{fontSize:13}}>Role: {item.role} · Review round: {item.reviewRound+1} · State: <strong>{item.status}</strong> ·
              {notes.length} visible inbox/message entries</p>
            <p><strong>Metric:</strong> {item.metric}</p>
            <p><strong>Reject when:</strong> {item.rejectionRule}</p>
            {execution&&<p><strong>Execution:</strong> {execution.status} · Model: {execution.model} ·
              {execution.callsFinished}/{execution.callsStarted} model calls committed/attempted ·
              {execution.inputTokens} input and {execution.outputTokens} output/thinking tokens reported.
              {execution.errorCode&&<> · <strong>Manual reconciliation required:</strong> {execution.errorCode}</>}
            </p>}
            <details><summary>Inter-agent message ledger</summary>
              <p>Entries are immutable routing envelopes or attributed worker messages.
                Brief delivery does not mean a model ran.</p>
              {notes.map(m=><div key={m.id} style={{padding:"8px 0",borderTop:"1px solid #ddd"}}>
                <strong>{m.kind}</strong> · {labels.get(m.senderId)??"Merchant brief"}
                {m.recipientId?" → "+(labels.get(m.recipientId)??"Assigned worker"):""}
                {m.verdict?" · "+m.verdict:""}
                <p style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{m.kind==="brief"
                  ?"Structured brief recorded; awaiting the worker execution adapter."
                  :m.body}</p>
              </div>)}
            </details>
          </article>;
        })}
      </div>
    </s-section>
    <s-section heading="Capacity examples · proposed, not billable">
      <p>Six SEO specialists require {requiredSkeptics(6)} SEO skeptics. Two blog
        specialists require {requiredSkeptics(2)} blog skeptic. Together that is
        eight specialist slots and three skeptics, requiring at least a Growth
        tier if these proposed subscription limits are activated.</p>
      <p>Possible plan capacities: Free 2, Starter 5, Growth 15, Scale 50 specialist
        slots. A model run additionally consumes metered research credits.
        Neither purchased slots nor unbounded autonomous execution is enabled today.</p>
    </s-section>
  </s-page>;
}

export const headers:HeadersFunction=args=>boundary.headers(args);
