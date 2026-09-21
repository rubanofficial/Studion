import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  bootstrap,
  createSubject,
  registerUser,
  resetDatabase,
  teardown,
} from './helpers.js';

beforeAll(bootstrap);
afterAll(teardown);
beforeEach(resetDatabase);

describe('subjects management', () => {
  it('creates, lists, updates, archives, and deletes a subject', async () => {
    const user = await registerUser();

    // Create
    const subject = await createSubject(user.authed, 'Operating Systems', {
      color: '#6366f1',
      description: 'Kernels and threads',
      weeklyTargetSeconds: 36000,
    });
    expect(subject.name).toBe('Operating Systems');
    expect(subject.color).toBe('#6366f1');

    // List
    const listRes = await user.authed.get('/api/subjects').expect(200);
    expect(listRes.body.data.subjects.length).toBe(1);

    // Update
    const updateRes = await user.authed
      .patch(`/api/subjects/${subject._id}`)
      .send({ name: 'OS & Distributed Systems' })
      .expect(200);
    expect(updateRes.body.data.subject.name).toBe('OS & Distributed Systems');

    // Archive
    const archiveRes = await user.authed
      .post(`/api/subjects/${subject._id}/archive`)
      .send({ archived: true })
      .expect(200);
    expect(archiveRes.body.data.subject.archivedAt).not.toBeNull();

    // List excluding archived
    const activeList = await user.authed.get('/api/subjects?includeArchived=false').expect(200);
    expect(activeList.body.data.subjects.length).toBe(0);

    // List including archived
    const allList = await user.authed.get('/api/subjects?includeArchived=true').expect(200);
    expect(allList.body.data.subjects.length).toBe(1);

    // Delete
    const deleteRes = await user.authed.delete(`/api/subjects/${subject._id}`).expect(200);
    expect(deleteRes.body.data.deleted).toBe(true);

    const finalList = await user.authed.get('/api/subjects?includeArchived=true').expect(200);
    expect(finalList.body.data.subjects.length).toBe(0);
  });
});

describe('tasks management', () => {
  it('creates, lists, gets next, updates, and deletes tasks', async () => {
    const user = await registerUser();
    const subject = await createSubject(user.authed, 'Data Structures');

    // Create tasks
    const taskRes1 = await user.authed
      .post('/api/tasks')
      .send({
        title: 'Red-Black Tree implementation',
        subjectId: subject._id,
        priority: 'high',
        estimatedDuration: 3600,
      })
      .expect(201);
    const task1 = taskRes1.body.data.task;
    expect(task1.title).toBe('Red-Black Tree implementation');

    const taskRes2 = await user.authed
      .post('/api/tasks')
      .send({
        title: 'Graph BFS & DFS',
        subjectId: subject._id,
        priority: 'medium',
        estimatedDuration: 1800,
      })
      .expect(201);
    const task2 = taskRes2.body.data.task;

    // List tasks
    const listRes = await user.authed.get('/api/tasks').expect(200);
    expect(listRes.body.data.tasks.length).toBe(2);

    // Next task (should pick high priority first)
    const nextRes = await user.authed.get('/api/tasks/next').expect(200);
    expect(nextRes.body.data.task.id).toBe(task1.id);

    // Update status to completed
    const updateRes = await user.authed
      .patch(`/api/tasks/${task1.id}`)
      .send({ status: 'completed' })
      .expect(200);
    expect(updateRes.body.data.task.status).toBe('completed');

    // Next task should now pick task2
    const nextRes2 = await user.authed.get('/api/tasks/next').expect(200);
    expect(nextRes2.body.data.task.id).toBe(task2.id);

    // Delete task2
    await user.authed.delete(`/api/tasks/${task2.id}`).expect(204);

    const remaining = await user.authed.get('/api/tasks?status=todo').expect(200);
    expect(remaining.body.data.tasks.length).toBe(0);
  });
});

describe('goals management', () => {
  it('creates, lists, updates, and deletes a goal', async () => {
    const user = await registerUser();

    // Create daily goal
    const goalRes = await user.authed
      .post('/api/goals')
      .send({
        period: 'daily',
        targetSeconds: 7200,
      })
      .expect(201);
    const goal = goalRes.body.data.goal;
    expect(goal.period).toBe('daily');
    expect(goal.targetSeconds).toBe(7200);

    // List goals
    const listRes = await user.authed.get('/api/goals').expect(200);
    expect(listRes.body.data.goals.length).toBe(1);
    expect(listRes.body.data.status).toBeDefined();

    // Update goal
    const updateRes = await user.authed
      .patch(`/api/goals/${goal.id}`)
      .send({ targetSeconds: 10800 })
      .expect(200);
    expect(updateRes.body.data.goal.targetSeconds).toBe(10800);

    // Delete goal
    await user.authed.delete(`/api/goals/${goal.id}`).expect(204);

    const emptyGoals = await user.authed.get('/api/goals').expect(200);
    expect(emptyGoals.body.data.goals.length).toBe(0);
  });
});
