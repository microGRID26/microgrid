import { describe, it, expect } from 'vitest'
import {
  TASKS,
  TASK_STATUSES,
  ALL_TASKS_FLAT,
  ALL_TASKS_MAP,
  TASK_TO_STAGE,
  TASK_DATE_FIELDS,
  getSameStageDownstream,
  isTaskRequired,
  AHJ_REQUIRED_TASKS,
} from '@/lib/tasks'
import { STAGE_ORDER } from '@/lib/utils'

// ── Automation logic tests ───────────────────────────────────────────────────
// These test the pure functions and data structures that drive the automation
// engine in ProjectPanel/TasksTab. The actual automations fire in the component
// but rely on these helpers for correctness.

// ── Auto-advance logic ───────────────────────────────────────────────────────
// When the last required task in a stage completes, the project should advance.
// We test the prerequisite data that powers this.

describe('auto-advance: stage task requirements', () => {
  it('every stage has at least one required task', () => {
    for (const stage of STAGE_ORDER) {
      const tasks = TASKS[stage]
      expect(tasks, `stage "${stage}" should have tasks`).toBeDefined()
      const required = tasks.filter(t => t.req)
      expect(required.length, `stage "${stage}" should have required tasks`).toBeGreaterThan(0)
    }
  })

  it('completing all required evaluation tasks means ready to advance', () => {
    const required = TASKS.evaluation.filter(t => t.req)
    expect(required.map(t => t.id)).toEqual(['welcome', 'ia', 'ub', 'sched_survey', 'ntp'])
  })

  it('completing all required survey tasks means ready to advance', () => {
    const required = TASKS.survey.filter(t => t.req)
    expect(required.map(t => t.id)).toEqual(['site_survey', 'survey_review'])
  })

  it('completing all required install tasks means ready to advance', () => {
    const required = TASKS.install.filter(t => t.req)
    expect(required.map(t => t.id)).toEqual(['sched_install', 'inventory', 'install_done'])
  })

  it('completing all required complete tasks means project is done', () => {
    const required = TASKS.complete.filter(t => t.req)
    expect(required.map(t => t.id)).toEqual(['pto', 'in_service'])
  })

  it('optional tasks do not block stage advancement', () => {
    // Design has optional tasks like stamps, wp1, prod_add
    const optional = TASKS.design.filter(t => !t.req)
    expect(optional.length).toBeGreaterThan(0)
    // These should not block advancement when left as Not Ready
    const optionalIds = optional.map(t => t.id)
    expect(optionalIds).toContain('stamps')
    expect(optionalIds).toContain('wp1')
  })
})

// ── Auto-blocker / auto-clear logic ──────────────────────────────────────────
// Tested via scenario: when a task enters Pending Resolution, the project gets blocked.
// When resolved and no other stuck tasks remain, the blocker clears.

describe('auto-blocker detection scenarios', () => {
  it('Pending Resolution and Revision Required are the only stuck statuses', () => {
    // The automation checks for these two specific statuses
    const stuckStatuses = ['Pending Resolution', 'Revision Required']
    for (const s of stuckStatuses) {
      expect(TASK_STATUSES).toContain(s)
    }
  })

  it('simulates single stuck task -> blocker set', () => {
    // Simulate the logic: if any task is stuck, project should be blocked
    const taskStates: Record<string, string> = {
      welcome: 'Complete',
      ia: 'Pending Resolution',
      ub: 'Ready To Start',
    }
    const stuckTasks = Object.entries(taskStates)
      .filter(([, status]) => status === 'Pending Resolution' || status === 'Revision Required')
    expect(stuckTasks).toHaveLength(1)
    expect(stuckTasks[0][0]).toBe('ia')
  })

  it('simulates stuck task resolved, no other stuck -> blocker clears', () => {
    const taskStates: Record<string, string> = {
      welcome: 'Complete',
      ia: 'Complete',  // was Pending Resolution, now resolved
      ub: 'In Progress',
    }
    const stuckTasks = Object.entries(taskStates)
      .filter(([, status]) => status === 'Pending Resolution' || status === 'Revision Required')
    expect(stuckTasks).toHaveLength(0)
    // blocker should be cleared
  })

  it('simulates one stuck resolved but another remains -> blocker stays', () => {
    const taskStates: Record<string, string> = {
      welcome: 'Pending Resolution',
      ia: 'Complete',  // was stuck, now resolved
      ub: 'Revision Required',
    }
    const stuckTasks = Object.entries(taskStates)
      .filter(([, status]) => status === 'Pending Resolution' || status === 'Revision Required')
    expect(stuckTasks).toHaveLength(2)
    // blocker should remain
  })
})

// ── Revision cascade ─────────────────────────────────────────────────────────

describe('revision cascade: getSameStageDownstream()', () => {
  it('build_design cascade resets scope and downstream in design stage', () => {
    const downstream = getSameStageDownstream('build_design')
    // build_design -> scope -> monitoring, build_eng, wp1, prod_add, new_ia, reroof, onsite_redesign, quote_ext_scope
    // scope -> build_eng -> eng_approval
    expect(downstream).toContain('scope')
    expect(downstream).toContain('monitoring')
    expect(downstream).toContain('build_eng')
    expect(downstream).toContain('eng_approval')
  })

  it('scope cascade does not include build_design (upstream)', () => {
    const downstream = getSameStageDownstream('scope')
    expect(downstream).not.toContain('build_design')
    // scope -> monitoring, build_eng, wp1, etc.
    expect(downstream).toContain('monitoring')
    expect(downstream).toContain('build_eng')
  })

  it('eng_approval has no downstream in design stage', () => {
    const downstream = getSameStageDownstream('eng_approval')
    // eng_approval has dependents in permit stage, not design
    expect(downstream).toHaveLength(0)
  })

  it('insp_review cascade includes downstream inspection tasks', () => {
    const downstream = getSameStageDownstream('insp_review')
    expect(downstream).toContain('sched_city')
    expect(downstream).toContain('sched_util')
    expect(downstream).toContain('city_insp')
    expect(downstream).toContain('util_insp')
  })

  it('sched_city cascade includes city_insp only', () => {
    const downstream = getSameStageDownstream('sched_city')
    expect(downstream).toContain('city_insp')
    expect(downstream).not.toContain('util_insp')
    expect(downstream).not.toContain('sched_util')
  })

  it('unknown task returns empty array', () => {
    const downstream = getSameStageDownstream('nonexistent_task')
    expect(downstream).toHaveLength(0)
  })

  it('task with no dependents returns empty array', () => {
    // in_service is the last task in the complete stage
    const downstream = getSameStageDownstream('in_service')
    expect(downstream).toHaveLength(0)
  })

  it('cascade does not cross stage boundaries', () => {
    // ntp is in evaluation, checkpoint1 depends on ntp but is in permit
    const downstream = getSameStageDownstream('ntp')
    expect(downstream).not.toContain('checkpoint1')
  })
})

// ── Funding triggers ─────────────────────────────────────────────────────────

describe('funding trigger task mappings', () => {
  it('install_done task exists and is required in install stage', () => {
    const task = ALL_TASKS_FLAT['install_done']
    expect(task).toBeDefined()
    expect(task.stage).toBe('install')
    expect(task.req).toBe(true)
    // Install Complete -> M2 Eligible
  })

  it('pto task exists and is required in complete stage', () => {
    const task = ALL_TASKS_FLAT['pto']
    expect(task).toBeDefined()
    expect(task.stage).toBe('complete')
    expect(task.req).toBe(true)
    // PTO Received -> M3 Eligible
  })
})

// ── Auto-ready: prereq chain ─────────────────────────────────────────────────

describe('auto-ready: prerequisite chain validation', () => {
  it('site_survey requires sched_survey', () => {
    const task = ALL_TASKS_FLAT['site_survey']
    expect(task.pre).toEqual(['sched_survey'])
  })

  it('checkpoint1 requires eng_approval, city_permit, util_permit, and ntp', () => {
    const task = ALL_TASKS_FLAT['checkpoint1']
    expect(task.pre).toContain('eng_approval')
    expect(task.pre).toContain('city_permit')
    expect(task.pre).toContain('util_permit')
    expect(task.pre).toContain('ntp')
    expect(task.pre).toHaveLength(4)
  })

  it('sched_install requires checkpoint1', () => {
    const task = ALL_TASKS_FLAT['sched_install']
    expect(task.pre).toEqual(['checkpoint1'])
  })

  it('tasks with no prerequisites are immediately ready', () => {
    const noPre = Object.values(ALL_TASKS_FLAT).filter(t => t.pre.length === 0)
    expect(noPre.length).toBeGreaterThan(0)
    // welcome, ia, ub, sched_survey, ntp should have no prereqs
    const noPreIds = noPre.map(t => t.id)
    expect(noPreIds).toContain('welcome')
    expect(noPreIds).toContain('ia')
    expect(noPreIds).toContain('stamps')
  })

  it('completing a task makes downstream tasks with all prereqs met ready', () => {
    // Simulate: sched_survey completed -> site_survey should become Ready To Start
    const taskId = 'sched_survey'
    const completedTasks = new Set([taskId])
    const task = ALL_TASKS_FLAT['site_survey']
    const allPreMet = task.pre.every(pre => completedTasks.has(pre))
    expect(allPreMet).toBe(true)
  })

  it('task with multiple prereqs is not ready until all are complete', () => {
    // checkpoint1 requires eng_approval, city_permit, util_permit, ntp
    const completedTasks = new Set(['eng_approval', 'city_permit'])  // missing util_permit, ntp
    const task = ALL_TASKS_FLAT['checkpoint1']
    const allPreMet = task.pre.every(pre => completedTasks.has(pre))
    expect(allPreMet).toBe(false)
  })

  it('task with multiple prereqs is ready when all are complete', () => {
    const completedTasks = new Set(['eng_approval', 'city_permit', 'util_permit', 'ntp'])
    const task = ALL_TASKS_FLAT['checkpoint1']
    const allPreMet = task.pre.every(pre => completedTasks.has(pre))
    expect(allPreMet).toBe(true)
  })
})

// ── TASK_DATE_FIELDS mapping ─────────────────────────────────────────────────

describe('TASK_DATE_FIELDS auto-populate mapping', () => {
  it('has 11 task-to-date mappings', () => {
    expect(Object.keys(TASK_DATE_FIELDS)).toHaveLength(11)
  })

  it('install_done maps to install_complete_date', () => {
    expect(TASK_DATE_FIELDS['install_done']).toBe('install_complete_date')
  })

  it('pto maps to pto_date', () => {
    expect(TASK_DATE_FIELDS['pto']).toBe('pto_date')
  })

  it('site_survey maps to survey_date', () => {
    expect(TASK_DATE_FIELDS['site_survey']).toBe('survey_date')
  })

  it('city_permit maps to city_permit_date', () => {
    expect(TASK_DATE_FIELDS['city_permit']).toBe('city_permit_date')
  })

  it('in_service maps to in_service_date', () => {
    expect(TASK_DATE_FIELDS['in_service']).toBe('in_service_date')
  })

  it('all mapped tasks exist in ALL_TASKS_FLAT', () => {
    for (const taskId of Object.keys(TASK_DATE_FIELDS)) {
      expect(ALL_TASKS_FLAT[taskId], `task "${taskId}" should exist in ALL_TASKS_FLAT`).toBeDefined()
    }
  })
})

// ── TASK_TO_STAGE mapping ────────────────────────────────────────────────────

describe('TASK_TO_STAGE mapping', () => {
  it('maps all tasks to their correct stage', () => {
    for (const [stage, tasks] of Object.entries(TASKS)) {
      for (const t of tasks) {
        expect(TASK_TO_STAGE[t.id]).toBe(stage)
      }
    }
  })
})

// ── ALL_TASKS_MAP (name lookup) ──────────────────────────────────────────────

describe('ALL_TASKS_MAP name lookup', () => {
  it('welcome maps to Welcome Call', () => {
    expect(ALL_TASKS_MAP['welcome']).toBe('Welcome Call')
  })

  it('install_done maps to Installation Complete', () => {
    expect(ALL_TASKS_MAP['install_done']).toBe('Installation Complete')
  })

  it('pto maps to Permission to Operate', () => {
    expect(ALL_TASKS_MAP['pto']).toBe('Permission to Operate')
  })
})

// ── AHJ-conditional requirements ─────────────────────────────────────────────

describe('AHJ-conditional task requirements', () => {
  it('wp1 is required for Corpus Christi', () => {
    const task = ALL_TASKS_FLAT['wp1']
    expect(isTaskRequired(task, 'Corpus Christi')).toBe(true)
  })

  it('wp1 is required for Texas City', () => {
    const task = ALL_TASKS_FLAT['wp1']
    expect(isTaskRequired(task, 'Texas City')).toBe(true)
  })

  it('wp1 is not required for Houston', () => {
    const task = ALL_TASKS_FLAT['wp1']
    expect(isTaskRequired(task, 'Houston')).toBe(false)
  })

  it('wpi28 is required for Corpus Christi', () => {
    const task = ALL_TASKS_FLAT['wpi28']
    expect(isTaskRequired(task, 'Corpus Christi')).toBe(true)
  })

  it('required tasks return true regardless of AHJ', () => {
    const task = ALL_TASKS_FLAT['welcome']
    expect(task.req).toBe(true)
    expect(isTaskRequired(task, null)).toBe(true)
    expect(isTaskRequired(task, 'Houston')).toBe(true)
  })

  it('optional tasks with no AHJ requirement return false', () => {
    const task = ALL_TASKS_FLAT['stamps']
    expect(task.req).toBe(false)
    expect(isTaskRequired(task, 'Houston')).toBe(false)
    expect(isTaskRequired(task, null)).toBe(false)
  })

  it('AHJ match is case-insensitive', () => {
    const task = ALL_TASKS_FLAT['wp1']
    expect(isTaskRequired(task, 'corpus christi')).toBe(true)
    expect(isTaskRequired(task, 'CORPUS CHRISTI')).toBe(true)
  })

  it('AHJ match supports prefix matching (e.g., "Corpus Christi ETJ")', () => {
    const task = ALL_TASKS_FLAT['wp1']
    expect(isTaskRequired(task, 'Corpus Christi ETJ')).toBe(true)
  })
})

// ── No cycles in prerequisite chain ──────────────────────────────────────────

describe('prerequisite chain integrity', () => {
  it('no task has itself as a prerequisite', () => {
    for (const tasks of Object.values(TASKS)) {
      for (const t of tasks) {
        expect(t.pre).not.toContain(t.id)
      }
    }
  })

  it('all prerequisites reference valid task IDs', () => {
    for (const tasks of Object.values(TASKS)) {
      for (const t of tasks) {
        for (const preId of t.pre) {
          expect(ALL_TASKS_FLAT[preId], `prereq "${preId}" of task "${t.id}" should exist`).toBeDefined()
        }
      }
    }
  })
})
