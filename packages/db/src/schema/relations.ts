import { relations } from "drizzle-orm";
import { teams, teamMembers } from "./teams.js";
import { user } from "./auth.js";
import { clusters } from "./clusters.js";
import { projects } from "./projects.js";
import { environments } from "./environments.js";
import { deployments, deploymentEvents, buildLogs } from "./deployments.js";
import { domains } from "./domains.js";
import { envVars } from "./env-vars.js";
import { jobs, jobEvents } from "./jobs.js";
import { k8sResources } from "./k8s-resources.js";

export const userRelations = relations(user, ({ many }) => ({
  memberships: many(teamMembers),
}));

export const teamsRelations = relations(teams, ({ many }) => ({
  members: many(teamMembers),
  clusters: many(clusters),
  projects: many(projects),
}));

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
  team: one(teams, { fields: [teamMembers.teamId], references: [teams.id] }),
  user: one(user, { fields: [teamMembers.userId], references: [user.id] }),
}));

export const clustersRelations = relations(clusters, ({ one, many }) => ({
  team: one(teams, { fields: [clusters.teamId], references: [teams.id] }),
  projects: many(projects),
  k8sResources: many(k8sResources),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  team: one(teams, { fields: [projects.teamId], references: [teams.id] }),
  cluster: one(clusters, { fields: [projects.clusterId], references: [clusters.id] }),
  environments: many(environments),
  deployments: many(deployments),
  domains: many(domains),
  envVars: many(envVars),
}));

export const environmentsRelations = relations(environments, ({ one, many }) => ({
  project: one(projects, { fields: [environments.projectId], references: [projects.id] }),
  deployments: many(deployments),
  domains: many(domains),
  envVars: many(envVars),
}));

export const deploymentsRelations = relations(deployments, ({ one, many }) => ({
  project: one(projects, { fields: [deployments.projectId], references: [projects.id] }),
  environment: one(environments, {
    fields: [deployments.environmentId],
    references: [environments.id],
  }),
  events: many(deploymentEvents),
  buildLogs: many(buildLogs),
}));

export const deploymentEventsRelations = relations(deploymentEvents, ({ one }) => ({
  deployment: one(deployments, {
    fields: [deploymentEvents.deploymentId],
    references: [deployments.id],
  }),
}));

export const buildLogsRelations = relations(buildLogs, ({ one }) => ({
  deployment: one(deployments, {
    fields: [buildLogs.deploymentId],
    references: [deployments.id],
  }),
}));

export const domainsRelations = relations(domains, ({ one }) => ({
  project: one(projects, { fields: [domains.projectId], references: [projects.id] }),
  environment: one(environments, {
    fields: [domains.environmentId],
    references: [environments.id],
  }),
}));

export const envVarsRelations = relations(envVars, ({ one }) => ({
  project: one(projects, { fields: [envVars.projectId], references: [projects.id] }),
  environment: one(environments, {
    fields: [envVars.environmentId],
    references: [environments.id],
  }),
}));

export const jobsRelations = relations(jobs, ({ many }) => ({
  events: many(jobEvents),
}));

export const jobEventsRelations = relations(jobEvents, ({ one }) => ({
  job: one(jobs, { fields: [jobEvents.jobId], references: [jobs.id] }),
}));

export const k8sResourcesRelations = relations(k8sResources, ({ one }) => ({
  cluster: one(clusters, { fields: [k8sResources.clusterId], references: [clusters.id] }),
  project: one(projects, { fields: [k8sResources.projectId], references: [projects.id] }),
  environment: one(environments, {
    fields: [k8sResources.environmentId],
    references: [environments.id],
  }),
  deployment: one(deployments, {
    fields: [k8sResources.deploymentId],
    references: [deployments.id],
  }),
}));
