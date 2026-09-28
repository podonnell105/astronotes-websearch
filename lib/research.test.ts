import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inferAnalystRole, inferQueryPolicy } from "./queryPolicy";
import { presetForRole } from "./dataCatalog";
import { detectFacets, buildResearchQueries } from "./researchPlan";
import { answerCoverage } from "./coverage";
import { hostIsDenied, isSocialDiscoveryHost } from "./sources";
import { filterRelevantResults } from "./relevance";
import { compileResearchSpec } from "./research/spec";
import { coverFacets } from "./research/coverage";
import { selectSources } from "./research/registry";
import { planIterationQueries } from "./research/planner";
import { knowledgeFromLegacy } from "./research/knowledge";

describe("role inference", () => {
  it("classifies political, biotech, vc, and govtech wording", () => {
    assert.equal(inferAnalystRole("Who are this MP's political donors?"), "political");
    assert.equal(inferAnalystRole("NIH clinical trial for this drug"), "biotech");
    assert.equal(inferAnalystRole("Series B funding and patents"), "vc");
    assert.equal(inferAnalystRole("USASpending federal contract award"), "govtech");
  });

  it("does not force a research preset for generic understand questions", () => {
    assert.equal(inferAnalystRole("Tell me about Elon Musk"), "custom");
    assert.equal(inferAnalystRole("Tell me about Tesla"), "custom");
    assert.equal(inferQueryPolicy("Tell me about Tesla").role, "custom");
    assert.deepEqual(presetForRole("political").slice(0, 3), [
      "uk_parliament",
      "uk_hansard",
      "uk_interests",
    ]);
  });
});

describe("facet queries", () => {
  it("detects donations and builds register queries", () => {
    const question = "Who are Jane Smith's political donors?";
    assert.ok(detectFacets(question).includes("donations"));
    const queries = buildResearchQueries(question, ["Jane Smith"]);
    assert.ok(queries.some((query) => /Electoral Commission/i.test(query)));
  });
});

describe("coverage scoring", () => {
  it("returns a low score with no graph", () => {
    const report = answerCoverage({
      query: "Tell me about Jane Smith",
      plan: {
        searchQuery: "Jane Smith",
        queries: ["Jane Smith"],
        subjects: ["Jane Smith"],
        allowNewEntities: true,
        gaps: ["identity"],
        facets: ["identity"],
        jurisdictions: [],
      },
      entities: [],
      relationships: [],
    });
    assert.equal(report.score, 0);
    assert.equal(report.answered, false);
  });

  it("names the missing facet instead of only a 7/10 score", () => {
    const spec = compileResearchSpec("Tell me about Jane Smith");
    const coverage = coverFacets({
      spec,
      entities: [{ id: "jane-smith", name: "Jane Smith", type: "person" }],
      relationships: [],
    });
    assert.ok(coverage.priorityGap);
    assert.ok(coverage.missing.includes(coverage.priorityGap));
    assert.notEqual(coverage.priorityGap, undefined);
  });
});

describe("source denial and geography", () => {
  it("denies shorteners and treats social hosts as discovery", () => {
    assert.equal(hostIsDenied("https://bit.ly/abc"), true);
    assert.equal(hostIsDenied("https://twitter.com/someone"), false);
    assert.equal(isSocialDiscoveryHost("https://x.com/someone"), true);
  });

  it("drops US money hosts for NI questions", () => {
    const { results, dropped } = filterRelevantResults(
      [
        {
          title: "Jane Smith FEC donor",
          url: "https://www.fec.gov/data/jane",
          snippet: "Jane Smith donations in the United States",
        },
        {
          title: "Jane Smith NI Assembly",
          url: "https://aims.niassembly.gov.uk/mlas/jane",
          snippet: "Jane Smith MLA Northern Ireland Stormont donations",
        },
      ],
      {
        subjects: ["Jane Smith"],
        facetKeywords: ["donation", "donors"],
        jurisdictions: ["NI"],
      },
    );
    assert.equal(results.some((item) => item.url.includes("niassembly")), true);
    assert.equal(dropped.some((item) => item.url.includes("fec.gov")), true);
  });
});

describe("research spec engine", () => {
  it("compiles person and company questions to the same intent", () => {
    const person = compileResearchSpec("Tell me about Elon Musk");
    const company = compileResearchSpec("Tell me about Tesla");
    assert.equal(person.intent, "understand");
    assert.equal(company.intent, "understand");
    assert.equal(person.subjects[0]?.type, "person");
    assert.equal(company.subjects[0]?.type, "company");
    assert.notEqual(person.subjects[0]?.type, company.subjects[0]?.type);
    const personSources = selectSources(person);
    const companySources = selectSources(company);
    assert.equal(personSources.includes("openfec"), false);
    assert.equal(personSources.includes("uk_parliament"), false);
    assert.ok(personSources.includes("web"));
    assert.ok(companySources.includes("web"));
  });

  it("selects NI/GB donation sources and not US money adapters", () => {
    const spec = compileResearchSpec(
      "Map publicly documented donations to this Northern Ireland MLA Jane Smith",
    );
    const sources = selectSources(spec, "donations");
    assert.ok(sources.includes("ni_assembly") || sources.includes("electoral_commission"));
    assert.equal(sources.includes("openfec"), false);
    assert.equal(sources.includes("senate_lda"), false);
  });

  it("follows a director relationship into company queries", () => {
    const spec = compileResearchSpec("Tell me about Jane Smith");
    const queries = planIterationQueries({
      spec,
      entities: [
        { id: "jane-smith", name: "Jane Smith", type: "person" },
        { id: "acme-ltd", name: "Acme Ltd", type: "company" },
      ],
      relationships: [
        {
          id: "jane-smith__officer_of__acme-ltd",
          source: "jane-smith",
          target: "acme-ltd",
          type: "officer_of",
          claim: "Jane Smith is a director of Acme Ltd",
          status: "deployed",
          basis: "recorded",
        },
      ],
      missing: ["products", "funding"],
      iteration: 2,
    });
    assert.ok(queries.some((query) => /Acme Ltd/i.test(query)));
    assert.ok(queries.some((query) => /product|funding|investor/i.test(query)));
  });
});

describe("knowledge state", () => {
  it("maps recorded register edges to facts and inferred edges to inferred", () => {
    assert.equal(
      knowledgeFromLegacy({
        relationship: {
          id: "a",
          source: "a",
          target: "b",
          type: "officer_of",
          claim: "director",
          status: "deployed",
          basis: "recorded",
        },
        validation: { decision: "SUPPORTED", model: "register", confidence: 1 },
      }),
      "fact",
    );
    assert.equal(
      knowledgeFromLegacy({
        relationship: {
          id: "b",
          source: "a",
          target: "c",
          type: "possible_overlap",
          claim: "overlap",
          status: "unclear",
          basis: "inferred",
        },
        validation: { decision: "UNCERTAIN", model: "rule", confidence: 0.4 },
      }),
      "inferred",
    );
  });
});
