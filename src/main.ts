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

export type GetProjectItemsQuery = {
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
  query GetProjectItems($login: String!, $number: Int!, $cursor: String) {
    organization(login: $login) {
      projectV2(number: $number) {
        items(first: 100, after: $cursor) {
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

async function* fetchAllProjectItems(
  octokit: ReturnType<typeof github.getOctokit>,
  loginName: string,
  projectNumber: number,
  cursor?: string
): AsyncIterable<ProjectV2Item> {
  const variables = { login: loginName, number: projectNumber, cursor }
  const response = await octokit.graphql<GetProjectItemsQuery>(
    GetProjectItemsQuery,
    variables
  )
  if (!response.organization?.projectV2?.items.nodes) {
    return
  }
  yield* response.organization.projectV2.items.nodes
  if (!response.organization.projectV2.items.pageInfo.hasNextPage) {
    return
  }
  yield* fetchAllProjectItems(
    octokit,
    loginName,
    projectNumber,
    response.organization.projectV2.items.pageInfo.endCursor
  )
}

// polyfill for Array.fromAsync
async function arrayFromAsync<T>(
  asyncIterable: AsyncIterable<T>
): Promise<T[]> {
  const items = [] as T[]
  for await (const item of asyncIterable) {
    items.push(item)
  }
  return items
}

async function calcSprintBurndownPoints(
  octokit: ReturnType<typeof github.getOctokit>,
  loginName: string,
  projectNumber: number
) {
  const items = await arrayFromAsync(
    fetchAllProjectItems(octokit, loginName, projectNumber)
  )

  if (items.length === 0) {
    return { remainingPoints: 0, totalPoints: 0 }
  }

  const today = LocalDate.now()

  const currentSprintItems = items
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
    const { remainingPoints, totalPoints } = await calcSprintBurndownPoints(
      octokit,
      loginName,
      projectNumber
    )
    core.setOutput('remaining-points', remainingPoints.toString())
    core.setOutput('total-points', totalPoints.toString())
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}
