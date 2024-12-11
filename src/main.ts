import * as core from '@actions/core'
import * as github from '@actions/github'
import { LocalDate } from '@js-joda/core'

type ProjectV2Item =
  | {
      type: 'DRAFT_ISSUE' | 'ISSUE' | 'PULL_REQUEST'
      pointField: { number: number } | null
      iterationField: {
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
  query GetProjectItems(
    $login: String!,
    $number: Int!,
    $pointFieldName: String!,
    $iterationFieldName: String!,
    $statusFieldName: String!,
    $cursor: String
  ) {
    organization(login: $login) {
      projectV2(number: $number) {
        items(first: 100, after: $cursor) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            type
            pointField: fieldValueByName(name: $pointFieldName) {
              ... on ProjectV2ItemFieldNumberValue {
                number
              }
            }
            iterationField: fieldValueByName(name: $iterationFieldName) {
              ... on ProjectV2ItemFieldIterationValue {
                iterationId
                startDate
                duration
              }
            }
            statusField: fieldValueByName(name: $statusFieldName) {
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

type GetProjectItemsQueryVariables = {
  login: string
  number: number
  pointFieldName: string
  iterationFieldName: string
  statusFieldName: string
  cursor?: string
}

async function* fetchAllProjectItems(
  octokit: ReturnType<typeof github.getOctokit>,
  variables: GetProjectItemsQueryVariables
): AsyncIterable<ProjectV2Item> {
  core.info(
    `Fetching project items with variables: ${JSON.stringify(variables)}`
  )
  const response = await octokit.graphql<GetProjectItemsQuery>(
    GetProjectItemsQuery,
    variables
  )
  if (!response.organization?.projectV2?.items.nodes) {
    return
  }
  core.info(
    `Fetched ${response.organization.projectV2.items.nodes.length} items`
  )
  yield* response.organization.projectV2.items.nodes
  if (!response.organization.projectV2.items.pageInfo.hasNextPage) {
    return
  }
  yield* fetchAllProjectItems(octokit, {
    ...variables,
    cursor: response.organization.projectV2.items.pageInfo.endCursor
  })
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

async function calcIterationBurndownPoints(
  octokit: ReturnType<typeof github.getOctokit>,
  variables: GetProjectItemsQueryVariables
) {
  const items = await arrayFromAsync(fetchAllProjectItems(octokit, variables))
  core.info(`Fetched ${items.length} items in total`)

  if (items.length === 0) {
    return { remainingPoints: 0, totalPoints: 0 }
  }

  const today = LocalDate.now()

  const currentIterationItems = items
    .filter((item) => item.type !== 'REDACTED')
    .filter((item) => {
      if (item.iterationField === null) {
        return false
      }
      const iterationStartDate = LocalDate.parse(item.iterationField.startDate)
      const iterationEndDate = iterationStartDate.plusDays(
        item.iterationField.duration
      )
      if (today.isBefore(iterationStartDate)) {
        return false
      }
      if (today.isAfter(iterationEndDate)) {
        return false
      }
      return true
    })

  core.info(
    `Found ${currentIterationItems.length} items in the current iteration`
  )

  let remainingPoints = 0
  let totalPoints = 0
  for (const item of currentIterationItems) {
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
    const githubToken = core.getInput('github-token', { required: true })
    const loginName = core.getInput('login-name', { required: true })
    const projectNumber = Number.parseInt(
      core.getInput('project-number', { required: true }),
      10
    )
    const pointFieldName = core.getInput('point-field-name')
    const iterationFieldName = core.getInput('iteration-field-name')
    const statusFieldName = core.getInput('status-field-name')

    const octokit = github.getOctokit(githubToken)
    const { remainingPoints, totalPoints } = await calcIterationBurndownPoints(
      octokit,
      {
        login: loginName,
        number: projectNumber,
        pointFieldName,
        iterationFieldName,
        statusFieldName
      }
    )
    core.setOutput('remaining-points', remainingPoints.toString())
    core.setOutput('total-points', totalPoints.toString())
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}
