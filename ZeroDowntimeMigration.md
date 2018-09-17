# Zero to Minimal Downtime Migration from TokuMX 2.x to PSMDB 3.x

### Author: David Bennett - david. bennett at percona. com
### Updated: 2016-04-21

## Overview

This document describes how to migrate from a source TokuMX 2.x server to
a target Percona Server for MongoDB 3.x (PSMDB) with zero to minimal downtime.
The migration process requires the following phases:

1. [Snapshot](#snapshot) - Point in time source Backup
2. [Dump](#dump) - Convert source backup to BSON
3. [Restore](#restore) - Load BSON into target
4. [Catchup](#catchup) - Play operation log from source to target
5. [Switch](#switch) - Reconfigure application layer to use target

![Zero Downtime Migration Diagram](https://raw.githubusercontent.com/dbpercona/tokumx2_to_psmdb3_migration/master/tokumx2%20to%20psmdb%203%200-downtime%20migration.png)

## Prerequisites

### Tools

These are the tools you will need to perform a minimal downtime migration.

1. TokuMX 2.x mongod with the Hot Backup plug-in enabled
2. mongodump utility from the TokuMX 2.x distribution
3. scripts from the tokumx2_to_psmdb3_migration Repository
4. mongorestore utility from the PSMDB 3.x distribution
5. toku2mongo oplog pull and playback tool

### Storage

You will need ~3x your current storage requirements available in order to
complete the migration<sup>1</sup>.

<sup>1</sup> Due to differences in compression and post-phase data cleanup,
  free space requirements may vary.

## Phase 1 - Snapshot <a name="snapshot"></a>

Due to the differences in the oplog format between TokuMX 2.x and PSMDB
3.x, there can be no overlap in the processing of the oplog between snapshot
and catchup. The operation playback must be a 'perfect splice' between the
starting data image and the catchup operations.   Because of this requirement,
a point in time 'snapshot' backup is required of the complete database.  We
will use the TokuMX Hot Backup plugin to accomplish this.

Before starting, the source server must be running with a Replica Set
configuration.  This insures that the operations that occur after the snapshot
is taken are being recorded for the catchup phase.   If the TokuMX server is
not running in Replica Set mode, it must be reconfigured and restarted.

For the sake of simplification, we will leave MongoDB authentication out of
these instructions.  So when the `mongo` shell is referenced in these
examples, it is assumed that you are connecting as admin with the proper
server credentials.

1. Check to see if the source server is in Replica Set mode:

    ```
    $ mongo --eval 'printjson(rs.status())'
    ```

    If the command returns `{ "ok" : 0, "errmsg" : "not running with --replSet"}`
    then the server is not running in Replica Set mode and must be reconfigured.
    Otherwise, the replica set name and members will be returned.  In this case
    the oplog is already active.

2. If the source server is *not* running in Replica Set mode, it will need to be
   reconfigured and restarted.  This can be accomplished in two ways:

    * The servers `tokumx.conf` configuration file can be modified to add
    a replica set name:

      ```
      replSet = rs0
      ```

    * Or, the command line used to start the server can be amended with the
    `--replSet=rs0` parameter.

    *Note:* `rs0` is used in this document as the Replica Set name.  You may 
    use another set name if required.

    After the server is restarted, you must initiate the replica set using the
    mongo shell:

    ```
    $ mongo --eval='printjson(rs.initiate())'
    ```

    After this is completed, you should be able to repeat step 1 of this phase
    to insure that the server is running in Replica Set mode.

3. Once you have verified the TokuMX 2.x server is running in Replica Set
   mode, it's time to create a hot backup of the source data.  This process is
   described in detail in the [Hot Backup section of the Percona TokuMX
   Documentation](https://www.percona.com/doc/percona-tokumx/hot_backup.html
                  "Hot Backup Documentation").

    For example (as root):

    ```
    # rm -rf /var/lib/tokumx_backup
    # mkdir -p /var/lib/tokumx_backup
    # chown tokumx. /var/lib/tokumx_backup
    # mongo
    > db.adminCommand({loadPlugin: 'backup_plugin'});  // if plug-in not loaded
    > db.adminCommand({backupStart:'/var/lib/tokumx_backup'});
    > quit();
    ```

    Once this is completed you should have a full point-in-time snapshot data
    image of your database.  You can verify this by listing your destination.

    ```
    # ls -l /var/lib/tokumx_backup/
    ```

## Phase 2 - Dump <a name="dump"></a>

Once the hot backup is complete, we begin the dump phase of migration.  This
involves launching a second instance of the TokuMX 2.x mongod server to run
recovery on the hot backup image (process the PerconaFT binary log),  capture
the max processed GTID for the catchup phase, dump the index definitions in
JSON format and dump the data image in BSON format that can be loaded into the
PSMDB 3.x target.

1. Launch our second instance of TokuMX 2.x.  It is not necessary to launch
   this server in Replica Set mode as we are just using it as a dormant image
   to record the max applied GTID, dump the index definitions and save the
   data image in BSON format.  If you are running the second instance on the
   same server as the live source,  it is important to select a different
   available port for the server to listen on.  For this example we will use
   port 27018.

    For example (as root):

    ```
    # su tokumx -s /bin/bash -c ' \
        mongod \
          --port=27018 \
          --dbpath=/var/lib/tokumx_backup \
          > ~/mongod_2.out 2>&1 &'
    ```

    After starting the second TokuMX 2.x mongod instance, you can verify
    recovery and insure that the instance is listening on your new alternate
    port.  The end of the new instances mongod log should resemble:

    ```
    # tail -n18 ~/mongod_2.out
    Thu Jan 28 00:27:28.946 [initandlisten] [tokumx] startup
    Thu Jan 28 00:27:28 2016 TokuFT recovery starting in env /var/lib/tokumx_backup
    Thu Jan 28 00:27:28 2016 TokuFT recovery scanning backward from 3485
    Thu Jan 28 00:27:28 2016 TokuFT recovery bw_end_checkpoint at 3485 timestamp 1453940832862533 xid 3467 (bw_newer)
    Thu Jan 28 00:27:28 2016 TokuFT recovery bw_begin_checkpoint at 3467 timestamp 1453940832862499 (bw_between)
    Thu Jan 28 00:27:28 2016 TokuFT recovery turning around at begin checkpoint 3467 time 34
    Thu Jan 28 00:27:28 2016 TokuFT recovery starts scanning forward to 3485 from 3467 left 18 (fw_between)
    Thu Jan 28 00:27:29 2016 TokuFT recovery closing 16 dictionaries
    Thu Jan 28 00:27:29 2016 TokuFT recovery making a checkpoint
    Thu Jan 28 00:27:29 2016 TokuFT recovery done
    Thu Jan 28 00:27:29.377 [initandlisten]
    Thu Jan 28 00:27:29.377 [initandlisten] ** WARNING: mongod started without --replSet yet 1 documents are present in local.system.replset
    Thu Jan 28 00:27:29.377 [initandlisten] **          Restart with --replSet unless you are doing maintenance and no other clients are connected.
    Thu Jan 28 00:27:29.377 [initandlisten] **          The TTL collection monitor will not start because of this.
    Thu Jan 28 00:27:29.377 [initandlisten] **          For more info see http://dochub.mongodb.org/core/ttlcollections
    Thu Jan 28 00:27:29.377 [initandlisten]
    Thu Jan 28 00:27:29.378 [initandlisten] waiting for connections on port 27018
    Thu Jan 28 00:27:29.378 [websvr] admin web console waiting for connections on port 28018
    ```

2. Now that our dormant backup of the live image is recovered and accessible,
   we can capture the max applied GTID.  This is the last operation that was
   recorded in the live image before backup.  This will allow us to start the
   catchup phase at the exact point-in-time following the creation of the hot
   backup image.

    Use the
    [`max_applied_gtid.js`](https://github.com/dbpercona/tokumx2_to_psmdb3_migration/blob/master/max_applied_gtid.js)
    script from the
    [github.com/dbpercona/tokumx2_to_psmdb3_migration](https://github.com/dbpercona/tokumx2_to_psmdb3_migration
                                                       "tokumx2_to_psmdb3_migration")
    repository to record the max applied GTID.

    It is important to save the GTID as we will need it in the catch up phase.
    In the example below, we save the GTID value into ~/max_applied_gtid.txt
    for later retrieval.

    ```
    $ cd ~
    $ git clone https://github.com/dbpercona/tokumx2_to_psmdb3_migration.git
    $ mongo \
        --port=27018 \
        --quiet tokumx2_to_psmdb3_migration/max_applied_gtid.js \
        | tee ~/max_applied_gtid.txt
    To catchup from this image, use the toku2mongo parameter: --gtid=1:3369151
    ```

3. Use the TokuMX 2.x mongodump tool to convert our dormant data from the
   secondary mongod server to a BSON image that can be loaded into PSMDB 3.x
   in the restore phase.

    ```
    $ mongodump --port=27018 -o tokumx2_dump
    ```

4. Due to differences in index attributes between TokuMX 2.x and PSMDB
   3.x, we also need to capture JSON output of the index definitions.  The
   indexes are defined separately during the restore phase.

    Use the
    [`tokumx_dump_indexes.js`](https://github.com/dbpercona/tokumx2_to_psmdb3_migration/blob/master/tokumx_dump_indexes.js)
    script from the
    [github.com/dbpercona/tokumx2_to_psmdb3_migration](https://github.com/dbpercona/tokumx2_to_psmdb3_migration
                                                       "tokumx2_to_psmdb3_migration")
    repository to dump the index definitions in JSON format.

    ```
    $ mongo --port=27018 --quiet \
        tokumx2_to_psmdb3_migration/tokumx_dump_indexes.js \
        > tokumx2_dump/tokumxIndexes.json
    ```

5. (Optional to save space) once you have completed this step, it is safe to
   shutdown the _secondary_ dormant mongod server and remove the TokuMX backup
   image.  Care should be taken to insure that you do not disrupt the
   operation of the live source server.

    ```
    # mongod --port=27018 --dbpath=/var/lib/tokumx_backup --shutdown
    # rm -rf /var/lib/tokumx_backup
    ```
6. ONLY IF USING AUTHENTICATION
   If you are running tokumx with authentication it will be necessary to convert the users collection.
   It will be necessary a MongoDB version 2.6 to perform this operation, this can be found [here] (http://downloads.mongodb.org/linux/mongodb-linux-x86_64-2.6.12.tgz)
   
   6.1) Start a mongodb 2.6 in a temp directory:
   ```
   # mkdir /tmp/mongo2.6
   # mongod --dbpath /tmp/mongo2.6 --logpath /tmp/mongo2.6/log.log --fork --smallfiles --port 27000
   ```
   6.2) Restore only the admin database using a 2.4 mongorestore.
   ```
   # mongorestore --port 27000 -d admin tokumx2_dump/admin
   # mv tokumx2_dump/admin /tmp/
   ```
   6.3) Connect to the mongodb 2.6 with a mongo 2.6 client and run the following commands, we expect to see an output similar to: 
   ```
   #mongo --port 27000
   > use admin
   > db.adminCommand({authSchemaUpgrade: 1 });
   { "done" : true, "ok" : 1 }
   ```
   6.4) Dump the 2.6 admin collection and move the folder to the 2.4 (tokuMX) backup, this can be done with a single command like:
   ```
   #mongodump --port 27000 -d admin -o tokumx2_dump
   ```
   At the end of this process the admin database will be ready to be restored in any MongoDB 3+


## Phase 3 - Restore <a name="restore"></a>

Now that we have our max applied GTID, our JSON index definitions and our BSON
data dump, we are ready to begin the import of data into PSMDB 3.x.  The
restore can be performed to a remote machine over a network connection or
a tarball distribution PSMDB 3.x can be installed on the same machine as
TokuMX 2.x and run on a separate port which may be faster depending on space
availability, network and block device speeds and existing load.

You will need to install the `mongorestore` binary from PSMDB 3.x onto
a system that has direct file access to your image created in the
dump phase.  Luckily, `mongorestore` has very few dynamic dependencies and is
very portable from system to system.

For the sake of this document, we will assume that you have installed the
PSMDB 3.x mongorestore binary on the TokuMX 2.x live source system `localhost`
and that you are restoring to a remote host called `psmdb3host` using the
default mongod port 27017.  You will need to configure the system firewall,
test connectivity and use authentication as required which is outside the
scope of this document.

1. Configure your new target server for use with the WiredTiger or RocksDB 
   storage engine. This can be accomplished in two ways:

    * The servers `/etc/mongo.conf` configuration file can be modified to enable
    the new storage engine:

      ```
      storage:
        engine: wiredTiger 
      ```
      or

      ```
      storage:
        engine: rocksdb  
      ```

    * Or, the command line used to start the server can be amended with the
    `--storageEngine=wiredTiger` or `--storageEngine=rocksdb` parameter.

    *Note:* A storage engine change requires completely purging the data
    directory, so this should be done on new PSMDB 3.x server.  For PSMDB 3.x
    installed from Percona packaging, the steps are:

    1. Stop the server
    2. Modify the `/etc/mongo.conf` configuration to use wiredTiger or rocksdb
    3. Delete all contents in the `/var/lib/mongo` directory
    4. Start the server (default data files will be created automatically)

2. Begin the restore process.  For this example we are beginning the restore
   from the live source system where we dumped the TokuMX 2.x dormant image.
   In this example we are copying the PSMDB 3.x mongorestore tool from the
   target system and using that to populate the target database.  The
   `--noIndexRestore` option insures that we don't restore the TokuMX 2.x
   index definitions which are incompatible with PSMDB 3.x.

   ```
   $ scp user@psmdb3host:/usr/bin/mongorestore .
   $ chmod 755 mongorestore
   $ ./mongorestore --host=psmdb3host --noIndexRestore tokumx2_dump/
   ```

   This process may take quite a while depending on the data size.  It should
   finish with a message similar to:

   ```
   2016-01-28T04:18:14.751+0000    finished restoring xxx.yyy (zzz documents)
   2016-01-28T04:18:14.751+0000    done
   ```

3. After the BSON data has been restored,  we can transfer the indexes that
   were saved in JSON format in the dump phase.

    Use the
    [`
    psmdb_restore_indexes.js`](https://github.com/dbpercona/tokumx2_to_psmdb3_migration/blob/master/psmdb_restore_indexes.js)
    script from the
    [github.com/dbpercona/tokumx2_to_psmdb3_migration](https://github.com/dbpercona/tokumx2_to_psmdb3_migration
                                                       "tokumx2_to_psmdb3_migration")
    repository to restore the index definitions to our target PSMDB 3.x
    server.

    ```
    $ mongo --host=psmdb3host \
      tokumx2_to_psmdb3_migration/psmdb_restore_indexes.js \
      --eval " data='tokumx2_dump/tokumxIndexes.json' "
    ```

    This process may take quite a while depending on the number of indexes and
    the data size.  You will be returned to the command prompt when the script
    is finished.

4. (Optional to save space) Now that the BSON image is fully restored to PSMDB
   3.x you can remove the BSON dump. Be sure to keep the max applied GTID
   recorded in the dump phase as it is needed in the catchup phase.

    ```
    $ rm -rf tokumx2_dump/
    ```

## Phase 4 - Catchup <a name="catchup"></a>

In this phase we sync up the new target PSMDB 3.x server with the live source
TokuMX 2.x server which has been continuing to operate through this entire
migration process.  In order to do this, we use the toku2mongo tool primed
with the GTID we recorded during the dump phase.

You can [download the toku2mongo tool](https://www.percona.com/downloads/toku2mongo)
from the Percona website.

1. Begin operation of the toku2mongo tool:

    ```
    $ tar xzvf toku2mongo-2.0.2-xxx-x86_64.tar.gz
    $ cd toku2mongo-2.0.2-xxx-x86_64
    $ cat ~/max_applied_gtid.txt 
    To catchup from this image, use the toku2mongo parameter: --gtid=1:3369151
    $ bin/toku2mongo --from localhost --gtid=1:3369151 \
        --host psmdb3host 2>&1 | tee ~/toku2mongo.out &
    ```

    The toku2mongo tool will continue to run and process the operations that
    have occured on the live source TokuMX 2.x system since the hot backup in
    the snapshot phase was complete.  

2. Monitor the progress of toku2mongo:

    You can use the command:

    ```
    $ grep -v 'pk =' ~/toku2mongo.out
    ```

    You will see output like:

    ```
    connected to: localhost:27018
    Tue Jan 26 05:04:23.561 [toku2mongo] synced up to 1:3370116 (Jan 26 02:43:36), source has up to 1:4864068 (Jan 26 05:04:23), 8447 seconds behind source.
    Tue Jan 26 05:04:33.562 [toku2mongo] synced up to 1:3383366 (Jan 26 02:44:41), source has up to 1:4866115 (Jan 26 05:04:33), 8391 seconds behind source.
    Tue Jan 26 05:04:43.562 [toku2mongo] synced up to 1:3396697 (Jan 26 02:45:45), source has up to 1:4868107 (Jan 26 05:04:43), 8337 seconds behind source.
    Tue Jan 26 05:04:53.562 [toku2mongo] synced up to 1:3409622 (Jan 26 02:46:49), source has up to 1:4870046 (Jan 26 05:04:53), 8284 seconds behind source.
    Tue Jan 26 05:05:03.564 [toku2mongo] synced up to 1:3421120 (Jan 26 02:47:46), source has up to 1:4872036 (Jan 26 05:05:03), 8237 seconds behind source.
    Tue Jan 26 05:05:13.565 [toku2mongo] synced up to 1:3432553 (Jan 26 02:48:43), source has up to 1:4874082 (Jan 26 05:05:13), 8190 seconds behind source.
    ```

    When the sync catches up you will see lines similar to:

    ```   
    Tue Jan 26 05:32:43.796 [toku2mongo] synced up to 1:5194652 (Jan 26 05:31:38), source has up to 1:5208180 (Jan 26 05:32:43), 65 seconds behind source.
    Tue Jan 26 05:32:53.795 [toku2mongo] synced up to 1:5204168 (Jan 26 05:32:24), source has up to 1:5210156 (Jan 26 05:32:53), 29 seconds behind source.
    Tue Jan 26 05:33:03.795 [toku2mongo] synced up to 1:5212280 (Jan 26 05:33:03), source has up to 1:5212280 (Jan 26 05:33:03), fully synced.
    Tue Jan 26 05:33:13.803 [toku2mongo] synced up to 1:5214145 (Jan 26 05:33:13), source has up to 1:5214148 (Jan 26 05:33:13), less than 1 second behind source.
    Tue Jan 26 05:33:23.815 [toku2mongo] synced up to 1:5216129 (Jan 26 05:33:23), source has up to 1:5216130 (Jan 26 05:33:23), less than 1 second behind source.
    Tue Jan 26 05:33:33.816 [toku2mongo] synced up to 1:5218075 (Jan 26 05:33:33), source has up to 1:5218080 (Jan 26 05:33:33), less than 1 second behind source.
    Tue Jan 26 05:33:43.844 [toku2mongo] synced up to 1:5220306 (Jan 26 05:33:43), source has up to 1:5220306 (Jan 26 05:33:43), fully synced.
    Tue Jan 26 05:33:53.868 [toku2mongo] synced up to 1:5222468 (Jan 26 05:33:53), source has up to 1:5222483 (Jan 26 05:33:53), less than 1 second behind source.
    Tue Jan 26 05:34:03.871 [toku2mongo] synced up to 1:5224477 (Jan 26 05:34:03), source has up to 1:5224479 (Jan 26 05:34:03), less than 1 second behind source.
    ```

    Leave toku2mongo running until the switch phase is complete.

## Phase 5 - Switch <a name="switch"></a>

When you are ready to switch your application over to PSMDB 3.x, leave toku2mongo
running through the entire process.  The specifics of how this procedure is
performed in your application environment are understandably outside the scope
of this document. In general, these are the steps required:

1. Pause your application's writes to TokuMX 2.x.

2. Wait until toku2mongo reports that it is "fully synced" a few times to the log.

3. Redirect your application to point to the PSMDB 3.x target system.

4. Shut down toku2mongo.

    ```
    $ killall -6 toku2mongo
    ```

The migration is now complete.  At this point you can shutdown the TokuMX 2.x server.

