import * as core from '@actions/core'
import * as github from '@actions/github'
import { LocalDate } from '@js-joda/core'

type ProjectV2Item =
  | {
      type: 'DRAFT_ISSUE' | 'ISSUE' | 'PULL_REQUEST'
      pointField: { number: number } | null
      sprintField: {
        iterationId: string
        startDate: string
        duration: number
      } | null
      statusField: { name: string } | null
    }
  | { type: 'REDACTED' }

type GetProjectItemsQuery = {
  organization: {
    projectV2: {
      items: {
        pageInfo: {
          hasNextPage: boolean
          endCursor: string
        }
        nodes: ProjectV2Item[] | null
      }
    } | null
  } | null
}

const GetProjectItemsQuery = /* GraphQL */ `
  query GetProjectItems($login: String!, $number: Int!) {
    organization(login: $login) {
      projectV2(number: $number) {
        items(first: 10) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            type
            pointField: fieldValueByName(name: "point") {
              ... on ProjectV2ItemFieldNumberValue {
                number
              }
            }
            sprintField: fieldValueByName(name: "sprint") {
              ... on ProjectV2ItemFieldIterationValue {
                iterationId
                startDate
                duration
              }
            }
            statusField: fieldValueByName(name: "Status") {
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
              }
            }
          }
        }
      }
    }
  }
`

async function calcSprintBurndownPoints(
  octokit: ReturnType<typeof github.getOctokit>,
  loginName: string,
  projectNumber: number
) {
  const response = await octokit.graphql<GetProjectItemsQuery>(
    GetProjectItemsQuery,
    {
      login: loginName,
      number: projectNumber
    }
  )

  if (!response.organization?.projectV2?.items.nodes) {
    throw new Error('No project items')
  }

  if (response.organization.projectV2.items.nodes.length === 0) {
    return { remainingPoints: 0, totalPoints: 0 }
  }

  const today = LocalDate.now()

  const currentSprintItems = response.organization.projectV2.items.nodes
    .filter(item => item.type !== 'REDACTED')
    .filter(item => {
      if (item.sprintField === null) {
        return false
      }
      const sprintStartDate = LocalDate.parse(item.sprintField.startDate)
      const sprintEndDate = sprintStartDate.plusDays(item.sprintField.duration)
      if (today.isBefore(sprintStartDate)) {
        return false
      }
      if (today.isAfter(sprintEndDate)) {
        return false
      }
      return true
    })

  let remainingPoints = 0
  let totalPoints = 0
  for (const item of currentSprintItems) {
    if (item.pointField === null) {
      continue
    }
    const points = item.pointField.number
    totalPoints += points
    if (item.statusField === null) {
      continue
    }
    if (item.statusField.name !== 'Done') {
      remainingPoints += points
    }
  }
  return { remainingPoints, totalPoints }
}

export async function run(): Promise<void> {
  try {
    const githubToken = core.getInput('github-token')
    const loginName = core.getInput('login-name')
    const projectNumber = Number.parseInt(core.getInput('project-number'), 10)
    const octokit = github.getOctokit(githubToken)
    const { remainingPoints, totalPoints } = await calcSprintBurndownPoints(octokit, loginName, projectNumber)
    core.setOutput('remainingPoints', remainingPoints.toString())
    core.setOutput('totalPoints', totalPoints.toString())
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}
