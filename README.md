# Distributed Job Queue for Node.js backed by Redis

## How it works

 * Register tasks that can be performed. Each task definition lives in its
   own node module.
 * When you submit a processing job, you choose which task to run and
   supply a resource ID. If multiple processing jobs are submitted for the
   same resource ID, only one of them will run at a time.
 * Jobs are taken from a redis queue; so the task could be performed on any
   computer with access to the resource.
 * When you want to shutdown, call `shutdown` and wait for the callback. This
   will shutdown the queue gracefully, allowing any in progress jobs to
   complete. This works well in tandem with [naught](https://github.com/andrewrk/naught)
 * Workers can either run as child processes for extra concurrency and safety,
   or can run in the same memory context as your main process, for extra
   simplicity and convenience.
 * This module is only made to work with the Redis single instance configuration.
 * When a job fails or the process dies while a job is executing, the job is
   moved to a failed jobs queue. You can then retry failed jobs or delete them.

## Synopsis

```js
var JobQueue = require('redis-dist-job-queue');
var jobQueue = new JobQueue();

jobQueue.registerTask("./foo_node_module");

jobQueue.start();

var options = {resourceId: 'resource_id', params: {theString: "derp"}};
jobQueue.submitJob('thisIsMyTaskId', options, function(err) {
  if (err) throw err;
  console.info("job submitted");
});

jobQueue.on('error', function(err) {
  console.error("job queue error:", err.stack);
});
```

`foo_node_module.js`:

```js
module.exports = {
  id: 'thisIsMyTaskId',
  perform: function(params, callback) {
    console.info(params.theString.toUpperCase());
    callback();
  },
};
```


## Documentation

### JobQueue([options])

`options`:

 * `namespace` - redis key namespace. Defaults to `"redis-dist-job-queue."`
 * `queueId` - the ID of the queue on redis that we are connecting to.
   Defaults to `"default"`.
 * `redisConfig` - defaults to an object with properties:
   * `host` - 127.0.0.1
   * `port` - 6379
   * `db` - 0
 * `childProcessCount` - If set to 0 (the default), no child processes are
   created. Instead all jobs are performed in the current process. If set to
   a positive number, that many worker child processes are created.
 * `workerCount` - number of workers *for this JobQueue instance*, per child
   process. So if `childProcessCount` is positive, total concurrency for this
   server is `childProcessCount * workerCount`. If `childProcessCount` is `0`,
   total concurrency for this server is `workerCount`. Defaults to the number
   of CPU cores on the computer.
 * `flushStaleTimeout` - every this many milliseconds, scan for jobs that
   crashed while executing and moves them from the processing queue to the
   failed job queue. Defaults to 30000.

### jobQueue.start()

Starts the desired number of workers listening on the queue.

It's quite possible that you never want to call `start()`. For example, the
case where you want a server to submit processing jobs, but not perform them.

### jobQueue.registerTask(modulePath)

You must register all the tasks you want to be able to perform before calling
`start()`.

`modulePath` is resolved just like a call to `require`.

The node module at `modulePath` must export these options:

 * `id` - unique task ID that identifies what function to call to perform
   the task
 * `perform(params, callback)` - function which actually does the task.
   * `params` - the same params you gave to `submitJob`, JSON encoded
      and then decoded.
   * `callback(err)` - call it when you're done processing. Until you call
     this callback, the resource is locked and no other processing job will
     touch it.

And it may export these optional options:

 * `timeout` - milliseconds since last heartbeat to wait before considering
   a job failed. defaults to `10000`.

### jobQueue.submitJob(taskId, options, callback)

Adds a job to the queue to be processed by the next available worker.

 * `taskId` - the `id` field of a task you registered with `registerTask`
   earlier.
 * `options` - object containing any of these properties:
   * `resourceId` - a unique identifier for the resource you are about to
     process. Only one job will run at a time per resource.
   * `params` - an object which will get serialized to and from JSON and then
     passed to the `perform` function of a task.
   * `retries` - how many times to retry a job before moving it to the failed
     queue. Defaults to 0.
 * `callback(err)` - lets you know when the job made it onto the queue

### jobQueue.shutdown(callback)

Gracefully begins the shutdown process allowing any ongoing tasks to finish.
`callback` is called once everything is completly shut down.

### jobQueue.retryFailedJobs(callback)

Moves all jobs from the failed queue to the pending queue.

### jobQueue.deleteFailedJobs(callback)

Deletes all jobs from the failed queue.

### jobQueue.forceFlushStaleJobs(callback)

Forces an immediate flushing of jobs that crashed while executing. Jobs of this
sort are put into the failed queue, and you can then retry or delete them.
You probably don't want to call `forceFlushStaleJobs` manually. It's mostly for
testing purposes.
