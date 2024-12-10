/**
 * Unit tests for the action's main functionality, src/main.ts
 *
 * These should be run as if the action was called from a workflow.
 * Specifically, the inputs listed in `action.yml` should be set as environment
 * variables following the pattern `INPUT_<INPUT_NAME>`.
 */

import * as core from '@actions/core'
import * as github from '@actions/github'
import { type GetProjectItemsQuery, run } from '../src/main'
import { LocalDate } from '@js-joda/core'

const GRAPHQL_RESPONSE: GetProjectItemsQuery = {
  organization: {
    projectV2: {
      items: {
        pageInfo: {
          hasNextPage: false,
          endCursor: 'Mw'
        },
        nodes: [
          {
            type: 'ISSUE',
            pointField: {
              number: 2
            },
            sprintField: {
              iterationId: '1234abcd',
              startDate: '2024-12-06',
              duration: 14
            },
            statusField: {
              name: 'In Progress'
            }
          },
          {
            type: 'ISSUE',
            pointField: {
              number: 3
            },
            sprintField: {
              iterationId: '1234abcd',
              startDate: '2024-12-06',
              duration: 14
            },
            statusField: {
              name: 'Done'
            }
          },
          {
            type: 'ISSUE',
            pointField: null,
            sprintField: {
              iterationId: '1234abcd',
              startDate: '2024-12-06',
              duration: 14
            },
            statusField: {
              name: 'Done'
            }
          },
          {
            type: 'PULL_REQUEST',
            pointField: {
              number: 3
            },
            sprintField: {
              iterationId: '5678efgh',
              startDate: '2024-12-20',
              duration: 7
            },
            statusField: {
              name: 'Done'
            }
          },
          {
            type: 'DRAFT_ISSUE',
            pointField: {
              number: 3
            },
            sprintField: null,
            statusField: {
              name: 'Product Backlog'
            }
          },
          { type: 'REDACTED' }
        ]
      }
    }
  }
}

describe('action', () => {
  let outputs: Record<string, string> = {}
  let setFailedMock: jest.SpiedFunction<typeof core.setFailed>

  beforeEach(() => {
    outputs = mockSetOutput()
    setFailedMock = jest.spyOn(core, 'setFailed')
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('with empty items', () => {
    it('sets output without fails', async () => {
      stubGithubGraphql([
        {
          organization: {
            projectV2: {
              items: {
                pageInfo: {
                  hasNextPage: false,
                  endCursor: 'Mw'
                },
                nodes: []
              }
            }
          }
        }
      ])

      await run()

      expect(outputs.remainingPoints).toBe('0')
      expect(outputs.totalPoints).toBe('0')
      expect(setFailedMock).not.toHaveBeenCalled()
    })
  })

  describe.each([
    '2024-12-06', // first day of sprint
    '2024-12-07', // holiday
    '2024-12-09', // next weekday
    '2024-12-19' // last day
  ])('with some items in current sprint', dateString => {
    it('sets output without fails on the first day', async () => {
      mockNow(LocalDate.parse(dateString))
      stubGithubGraphql([GRAPHQL_RESPONSE])

      await run()

      expect(outputs.remainingPoints).toBe('2')
      expect(outputs.totalPoints).toBe('5')
      expect(setFailedMock).not.toHaveBeenCalled()
    })
  })

  describe('with 0 items in current sprint', () => {
    it('sets output without fails', async () => {
      mockNow(LocalDate.of(2024, 12, 5))
      stubGithubGraphql([GRAPHQL_RESPONSE])

      await run()

      expect(outputs.remainingPoints).toBe('0')
      expect(outputs.totalPoints).toBe('0')
      expect(setFailedMock).not.toHaveBeenCalled()
    })
  })

  describe('with pagination', () => {
    it('sets output without fails', async () => {
      mockNow(LocalDate.of(2024, 12, 10))
      stubGithubGraphql([
        {
          organization: {
            projectV2: {
              items: {
                pageInfo: {
                  hasNextPage: true,
                  endCursor: 'Mw'
                },
                nodes: [
                  {
                    type: 'ISSUE',
                    pointField: {
                      number: 2
                    },
                    sprintField: {
                      iterationId: '1234abcd',
                      startDate: '2024-12-06',
                      duration: 14
                    },
                    statusField: {
                      name: 'Done'
                    }
                  }
                ]
              }
            }
          }
        },
        {
          organization: {
            projectV2: {
              items: {
                pageInfo: {
                  hasNextPage: false,
                  endCursor: 'Mm'
                },
                nodes: [
                  {
                    type: 'ISSUE',
                    pointField: {
                      number: 1
                    },
                    sprintField: {
                      iterationId: '1234abcd',
                      startDate: '2024-12-06',
                      duration: 14
                    },
                    statusField: {
                      name: 'In Progress'
                    }
                  }
                ]
              }
            }
          }
        }
      ])

      await run()

      expect(outputs.remainingPoints).toBe('1')
      expect(outputs.totalPoints).toBe('3')
      expect(setFailedMock).not.toHaveBeenCalled()
    })
  })
})

function mockSetOutput(): Record<string, string> {
  const dummyOutputs: Record<string, string> = {}
  jest.spyOn(core, 'setOutput').mockImplementation((name, value) => {
    dummyOutputs[name] = value
  })
  return dummyOutputs
}

function mockNow(date: LocalDate) {
  jest.spyOn(LocalDate, 'now').mockReturnValue(date)
}

function stubGithubGraphql(responses: GetProjectItemsQuery[]) {
  let mockOctokitGraphql = jest.fn()
  for (const response of responses) {
    mockOctokitGraphql = mockOctokitGraphql.mockReturnValueOnce(response)
  }

  jest.spyOn(github, 'getOctokit').mockReturnValue({
    graphql: mockOctokitGraphql
  } as unknown as ReturnType<typeof github.getOctokit>)
}
