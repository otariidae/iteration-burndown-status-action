/**
 * Unit tests for the action's main functionality, src/main.ts
 *
 * These should be run as if the action was called from a workflow.
 * Specifically, the inputs listed in `action.yml` should be set as environment
 * variables following the pattern `INPUT_<INPUT_NAME>`.
 */

import * as core from '@actions/core'
import * as github from '@actions/github'
import { LocalDate } from '@js-joda/core'
import { type GetProjectItemsQuery, run } from '../src/main'

const ITERATION_2024_12_06 = {
  iterationId: '1234abcd',
  startDate: '2024-12-06',
  duration: 14
} as const

describe('action', () => {
  let outputs: Record<string, string> = {}
  let dummyInputs: Record<string, string> = {}
  let setFailedMock: jest.SpiedFunction<typeof core.setFailed>

  beforeEach(() => {
    outputs = mockSetOutput()
    setFailedMock = jest.spyOn(core, 'setFailed')
    dummyInputs = {
      'github-token': 'dummy',
      'login-name': 'octocat',
      'project-number': '123',
      'point-field-name': 'points',
      'iteration-field-name': 'Sprint',
      'status-field-name': 'Status',
      'status-completed-value': 'Done',
      'grouping-field-name': ''
    }
    mockGetInput(dummyInputs)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe.each([
    '2024-12-06', // first day of sprint
    '2024-12-07', // holiday
    '2024-12-09', // next weekday
    '2024-12-19' // last day
  ])('with previous and next iteatation', (dateString) => {
    it('does not count items outside the current iteration', async () => {
      mockNow(LocalDate.parse(dateString))
      stubGithubGraphql([
        {
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
                    iterationField: {
                      iterationId: '5678efgh',
                      startDate: '2024-12-20', // next iteration
                      duration: 7
                    },
                    statusField: {
                      name: 'Done'
                    },
                    groupingField: null
                  },
                  {
                    type: 'ISSUE',
                    pointField: {
                      number: 3
                    },
                    iterationField: ITERATION_2024_12_06,
                    statusField: {
                      name: 'Done'
                    },
                    groupingField: null
                  },
                  {
                    type: 'ISSUE',
                    pointField: {
                      number: 8
                    },
                    iterationField: {
                      iterationId: 'abcd1234',
                      startDate: '2024-11-22', // previous iteration
                      duration: 14
                    },
                    statusField: {
                      name: 'Done'
                    },
                    groupingField: null
                  }
                ]
              }
            }
          }
        }
      ])

      await run()

      expect(outputs['remaining-points']).toBe('0')
      expect(outputs['total-points']).toBe('3')
      expect(setFailedMock).not.toHaveBeenCalled()
    })
  })

  describe('with pagination', () => {
    it('sums points from all pages', async () => {
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
                    iterationField: ITERATION_2024_12_06,
                    statusField: {
                      name: 'Done'
                    },
                    groupingField: null
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
                    iterationField: ITERATION_2024_12_06,
                    statusField: {
                      name: 'In Progress'
                    },
                    groupingField: null
                  }
                ]
              }
            }
          }
        }
      ])

      await run()

      expect(outputs['remaining-points']).toBe('1')
      expect(outputs['total-points']).toBe('3')
      expect(setFailedMock).not.toHaveBeenCalled()
    })
  })

  describe('with some null pointField', () => {
    it('does not count items with null point', async () => {
      mockNow(LocalDate.of(2024, 12, 10))
      stubGithubGraphql([
        {
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
                    pointField: null,
                    iterationField: ITERATION_2024_12_06,
                    statusField: {
                      name: 'Done'
                    },
                    groupingField: null
                  },
                  {
                    type: 'ISSUE',
                    pointField: {
                      number: 3
                    },
                    iterationField: ITERATION_2024_12_06,
                    statusField: {
                      name: 'Done'
                    },
                    groupingField: null
                  }
                ]
              }
            }
          }
        }
      ])

      await run()

      expect(outputs['remaining-points']).toBe('0')
      expect(outputs['total-points']).toBe('3')
      expect(setFailedMock).not.toHaveBeenCalled()
    })
  })

  describe('with some null iterationField', () => {
    it('does not count items with null iteration', async () => {
      mockNow(LocalDate.of(2024, 12, 10))
      stubGithubGraphql([
        {
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
                    iterationField: null,
                    statusField: {
                      name: 'Done'
                    },
                    groupingField: null
                  },
                  {
                    type: 'ISSUE',
                    pointField: {
                      number: 3
                    },
                    iterationField: ITERATION_2024_12_06,
                    statusField: {
                      name: 'Done'
                    },
                    groupingField: null
                  }
                ]
              }
            }
          }
        }
      ])

      await run()

      expect(outputs['remaining-points']).toBe('0')
      expect(outputs['total-points']).toBe('3')
      expect(outputs['grouping-results']).toBe('{}')
      expect(setFailedMock).not.toHaveBeenCalled()
    })
  })

  describe('with some null statusField', () => {
    it('treats items with null status as remaining', async () => {
      mockNow(LocalDate.of(2024, 12, 10))
      stubGithubGraphql([
        {
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
                    iterationField: ITERATION_2024_12_06,
                    statusField: null,
                    groupingField: null
                  },
                  {
                    type: 'ISSUE',
                    pointField: {
                      number: 3
                    },
                    iterationField: ITERATION_2024_12_06,
                    statusField: {
                      name: 'Done'
                    },
                    groupingField: null
                  }
                ]
              }
            }
          }
        }
      ])

      await run()

      expect(outputs['remaining-points']).toBe('2')
      expect(outputs['total-points']).toBe('5')
      expect(outputs['grouping-results']).toBe('{}')
      expect(setFailedMock).not.toHaveBeenCalled()
    })
  })

  describe('with grouping-field-name', () => {
    it('sums points for each group', async () => {
      mockNow(LocalDate.of(2024, 12, 10))
      dummyInputs['grouping-field-name'] = 'Epic'
      stubGithubGraphql([
        {
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
                    iterationField: ITERATION_2024_12_06,
                    statusField: {
                      name: 'In Progress'
                    },
                    groupingField: {
                      name: 'Epic1'
                    }
                  },
                  {
                    type: 'ISSUE',
                    pointField: {
                      number: 3
                    },
                    iterationField: ITERATION_2024_12_06,
                    statusField: {
                      name: 'Done'
                    },
                    groupingField: {
                      name: 'Epic2'
                    }
                  },
                  {
                    type: 'ISSUE',
                    pointField: {
                      number: 7
                    },
                    iterationField: ITERATION_2024_12_06,
                    statusField: {
                      name: 'Done'
                    },
                    groupingField: {
                      name: 'Epic1'
                    }
                  }
                ]
              }
            }
          }
        }
      ])

      await run()

      expect(outputs['remaining-points']).toBe('2')
      expect(outputs['total-points']).toBe('12')
      expect(outputs['grouping-results']).toBe(
        JSON.stringify({
          Epic1: { remainingPoints: 2, totalPoints: 9 },
          Epic2: { remainingPoints: 0, totalPoints: 3 }
        })
      )
      expect(setFailedMock).not.toHaveBeenCalled()
    })

    describe('with some null groupingField', () => {
      it('does not count items in groups with null grouping', async () => {
        mockNow(LocalDate.of(2024, 12, 10))
        dummyInputs['grouping-field-name'] = 'Epic'
        stubGithubGraphql([
          {
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
                      iterationField: ITERATION_2024_12_06,
                      statusField: {
                        name: 'Done'
                      },
                      groupingField: {
                        name: 'Epic1'
                      }
                    },
                    {
                      type: 'ISSUE',
                      pointField: {
                        number: 3
                      },
                      iterationField: ITERATION_2024_12_06,
                      statusField: {
                        name: 'In Progress'
                      },
                      groupingField: null
                    }
                  ]
                }
              }
            }
          }
        ])

        await run()

        expect(outputs['remaining-points']).toBe('3')
        expect(outputs['total-points']).toBe('5')
        expect(outputs['grouping-results']).toBe(
          JSON.stringify({
            Epic1: { remainingPoints: 0, totalPoints: 2 }
          })
        )
        expect(setFailedMock).not.toHaveBeenCalled()
      })
    })
  })

  describe('with empty items', () => {
    it('sets zero points', async () => {
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

      expect(outputs['remaining-points']).toBe('0')
      expect(outputs['total-points']).toBe('0')
      expect(outputs['grouping-results']).toBe('{}')
      expect(setFailedMock).not.toHaveBeenCalled()
    })
  })

  describe('with redacted items', () => {
    it('does not count redacted items', async () => {
      stubGithubGraphql([
        {
          organization: {
            projectV2: {
              items: {
                pageInfo: {
                  hasNextPage: false,
                  endCursor: 'Mw'
                },
                nodes: [{ type: 'REDACTED' }]
              }
            }
          }
        }
      ])

      await run()

      expect(outputs['remaining-points']).toBe('0')
      expect(outputs['total-points']).toBe('0')
      expect(outputs['grouping-results']).toBe('{}')
      expect(setFailedMock).not.toHaveBeenCalled()
    })
  })

  describe('with non-numeric project-number', () => {
    it('fails', async () => {
      dummyInputs['project-number'] = 'abc'

      await run()

      expect(outputs).toEqual({})
      expect(setFailedMock).toHaveBeenCalled()
    })
  })
  describe('with empty point-field-name', () => {
    it('fails', async () => {
      dummyInputs['point-field-name'] = ''

      await run()

      expect(outputs).toEqual({})
      expect(setFailedMock).toHaveBeenCalled()
    })
  })
  describe('with empty iteration-field-name', () => {
    it('fails', async () => {
      dummyInputs['iteration-field-name'] = ''

      await run()

      expect(outputs).toEqual({})
      expect(setFailedMock).toHaveBeenCalled()
    })
  })
  describe('with empty status-field-name', () => {
    it('fails', async () => {
      dummyInputs['status-field-name'] = ''

      await run()

      expect(outputs).toEqual({})
      expect(setFailedMock).toHaveBeenCalled()
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

function mockGetInput(inputs: Record<string, string>) {
  jest.spyOn(core, 'getInput').mockImplementation((name: string) => {
    if (inputs[name] === undefined) {
      throw new Error(`Unexpected input name: ${name}`)
    }
    return inputs[name]
  })
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
