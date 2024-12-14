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
      groupingField: { name: string } | null
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
    $groupingFieldName: String!,
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
            groupingField: fieldValueByName(name: $groupingFieldName) {
              ...on ProjectV2ItemFieldSingleSelectValue {
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
  groupingFieldName: string
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

function filterCurrentIterationItems(items: ProjectV2Item[]) {
  const today = LocalDate.now()
  return items
    .filter((item) => item.type !== 'REDACTED')
    .filter((item) => {
      if (item.iterationField === null) {
        return false
      }
      const iterationStartDate = LocalDate.parse(item.iterationField.startDate)
      const iterationEndDate = iterationStartDate.plusDays(
        item.iterationField.duration - 1
      )
      // return false if today is before the start date or after the end date
      return (
        !today.isBefore(iterationStartDate) && !today.isAfter(iterationEndDate)
      )
    })
}

function calcIterationBurndownPoints(
  items: ProjectV2Item[],
  statusCompletedValue: string
) {
  if (items.length === 0) {
    return { remainingPoints: 0, totalPoints: 0, groupingResult: new Map() }
  }

  const currentIterationItems = filterCurrentIterationItems(items)

  core.info(
    `Found ${currentIterationItems.length} items in the current iteration`
  )

  // sum up points for each grouping
  const groupingResult = new Map<
    string | undefined,
    { remainingPoints: number; totalPoints: number }
  >()
  for (const item of currentIterationItems) {
    if (item.pointField === null) {
      continue
    }
    const groupName = item.groupingField?.name
    const group = groupingResult.get(groupName) ?? {
      remainingPoints: 0,
      totalPoints: 0
    }
    const points = item.pointField.number
    group.totalPoints += points
    if (item.statusField?.name !== statusCompletedValue) {
      group.remainingPoints += points
    }
    groupingResult.set(groupName, group)
  }

  let remainingPoints = 0
  let totalPoints = 0
  for (const group of groupingResult.values()) {
    remainingPoints += group.remainingPoints
    totalPoints += group.totalPoints
  }
  return { remainingPoints, totalPoints, groupingResult }
}

function mapToObject<K, V>(map: Map<K, V>): Record<string, V> {
  const obj = {} as Record<string, V>
  for (const [key, value] of map.entries()) {
    if (key === undefined) {
      continue
    }
    obj[key as unknown as string] = value
  }
  return obj
}

type GetInputOptions = core.InputOptions & {
  presence?: boolean
  integerity?: boolean
}

// return number if integerity is true, otherwise return string
function getInput(
  name: string,
  options: GetInputOptions & { integerity: true }
): number
function getInput(
  name: string,
  options?: GetInputOptions & { integerity?: false }
): string

// a thin wrapper of core.getInput with validation
function getInput(name: string, options?: GetInputOptions): string | number {
  const value = core.getInput(name, options)
  if (options?.presence && value === '') {
    throw new Error(`${name} must not be empty`)
  }
  if (options?.integerity) {
    const valueAsInt = Number.parseInt(value, 10)
    if (Number.isNaN(valueAsInt)) {
      throw new Error(`${name} must be an integer`)
    }
    return valueAsInt
  }
  return value
}

export async function run(): Promise<void> {
  try {
    const githubToken = getInput('github-token', { required: true })
    const loginName = getInput('login-name', { required: true })
    const projectNumber = getInput('project-number', {
      required: true,
      integerity: true
    })
    const pointFieldName = getInput('point-field-name', { presence: true })
    const iterationFieldName = getInput('iteration-field-name', {
      presence: true
    })
    const statusFieldName = getInput('status-field-name', { presence: true })
    const statusCompletedValue = getInput('status-completed-value', {
      presence: true
    })
    const groupingFieldName = getInput('grouping-field-name')

    const octokit = github.getOctokit(githubToken)
    const items = await arrayFromAsync(
      fetchAllProjectItems(octokit, {
        login: loginName,
        number: projectNumber,
        pointFieldName,
        iterationFieldName,
        groupingFieldName,
        statusFieldName
      })
    )

    const { remainingPoints, totalPoints, groupingResult } =
      await calcIterationBurndownPoints(items, statusCompletedValue)
    core.setOutput('remaining-points', remainingPoints.toString())
    core.setOutput('total-points', totalPoints.toString())
    core.setOutput(
      'grouping-results',
      JSON.stringify(mapToObject(groupingResult))
    )
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}
