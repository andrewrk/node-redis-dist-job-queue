var JobQueue = require('..');
var assert = require('assert');
var path = require('path');
var shared = require('./shared');
var fs = require('fs');
var redis = require('redis');

var describe = global.describe;
var it = global.it;
var after = global.after;
var beforeEach = global.beforeEach;

var hitCountFile = path.resolve(__dirname, "hitCount.txt");

describe("JobQueue", function() {
  beforeEach(function(done) {
    var redisClient = redis.createClient();
    redisClient.send_command('flushdb', [], done);
  });

  after(function(done) {
    fs.unlink(hitCountFile, function(err) {
      done();
    });
  });

  it("processes a thing and then shuts down - in process", function(done) {
    var jobQueue = new JobQueue({ workerCount: 8 });
    shared.processedString = null;
    shared.callback = function(params) {
      assert.strictEqual(params, null);
      jobQueue.shutdown(function() {
        assert.strictEqual(shared.processedString, "DERP");
        done();
      });
    };

    jobQueue.registerTask('./task1');
    jobQueue.registerTask('./task_cb');

    jobQueue.start();

    jobQueue.submitJob('thisIsMyTaskId', 'resource_id', {theString: "derp"}, assert.ifError);
    jobQueue.submitJob('callback', 'resource_id_2', null, assert.ifError);
  });

  it("processes a thing and then shuts down - child processes", function(done) {
    var jobQueue = new JobQueue({ workerCount: 1, childProcessCount: 8 });

    fs.writeFileSync(hitCountFile, "0");

    jobQueue.registerTask('./task_hit_count');

    jobQueue.start();

    var count = 20;
    for (var i = 0; i < count; i += 1) {
      jobQueue.submitJob('hitCount', 'hit_count', hitCountFile, assert.ifError);
    }

    jobQueue.on('jobSuccess', function(err) {
      count -= 1;
      if (count === 0) return checkIt();
      if (count < 0) throw new Error("more job completions than expected");
    });

    function checkIt() {
      jobQueue.shutdown(function() {
        fs.readFile(hitCountFile, function(err, data) {
          if (err) throw err;
          assert.strictEqual(parseInt(data, 10), 20);
          done();
        });
      });
    }
  });

  it("moves jobs to failed queue and back", function(done) {
    shared.count = 0;

    var jobQueue = new JobQueue({ workerCount: 4 });

    jobQueue.once('jobFail', function() {
      jobQueue.retryFailedJobs(function(err) {
        if (err) return done(err);
      });
    });

    jobQueue.once('jobSuccess', function() {
      assert.strictEqual(shared.count, 2);
      jobQueue.shutdown(done);
    });

    jobQueue.registerTask('./task_fail');

    jobQueue.start();

    jobQueue.submitJob('failFirst', 'foo', null, assert.ifError);
  });

  it("ability to delete failed jobs", function(done) {
    shared.count = 0;

    var jobQueue = new JobQueue({ workerCount: 1 });

    jobQueue.on('jobFail', function() {
      jobQueue.deleteFailedJobs(function(err) {
        if (err) return done(err);
        jobQueue.retryFailedJobs(function(err) {
          if (err) return done(err);
          shared.callback = function() {
            assert.strictEqual(shared.count, 1);
            jobQueue.shutdown(done);
          };
          jobQueue.submitJob('callback', 'foo2', null, assert.ifError);
        });
      });
    });

    jobQueue.registerTask('./task_fail');
    jobQueue.registerTask('./task_cb');

    jobQueue.start();

    jobQueue.submitJob('failFirst', 'foo', null, assert.ifError);
  });

  it("handles jobs that crash while processing", function(done) {
    var jobQueue = new JobQueue({ childProcessCount: 3, workerCount: 1});

    jobQueue.once('childRestart', function() {
      jobQueue.once('jobFail', function(job) {
        assert.strictEqual(job.type, 'crashTask');
        jobQueue.shutdown(done);
      });

      setTimeout(function() {
        jobQueue.forceFlushStaleJobs(assert.ifError);
      }, 200);
    });


    jobQueue.registerTask('./task_crash');

    jobQueue.start();

    jobQueue.submitJob('crashTask', 'derpy', null, assert.ifError);
  });
});
