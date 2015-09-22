# TokuMX 2.0.x to Percona Server for MongoDB 3.0.x migration

1. Restart the tokumx server without the `--auth` parameter

         service tokumx stop
         sed -i'' s/^auth/#auth/ /etc/tokumx.conf
         service tokumx start

2. Run the `allDbStats.js` script to record db state before migration
 
         mongo  ./allDbStats.js > ~/allDbStats.before.out

3. Dump the database:

        mongodump --dbpath {db path} --out {dump path}

4. Dump the indexes:

        ./tokumx_dump_indexes.js > {dump path}/tokumxIndexes.json

5. Stop the tokumx server.

        service tokumx stop

6. Move the data directory and copy configuration for safe keeping.

        mv /var/lib/tokumx /var/lib/tokumx.bak
        cp /etc/tokumx.conf /etc/tokumx.conf.bak

7. Uninstall all tokumx packages, make sure conf files are gone

        dpkg -P --force-all `dpkg -l | grep tokumx | awk '{print $2}'`

8. Install PSMDB:

        # This assumes you've configured the correct Percona repository

        apt-get install -y \
            percona-server-mongodb-server \
            percona-server-mongodb-shell \
            percona-server-mongodb-tools

9. Configure the storageEngine and turn off `--auth` in `/etc/mongod.conf`

         sed -i'' s/^storageEngine/#storageEngine/ /etc/mongod.conf
         sed -i'' s/^#storageEngine=PerconaFT/storageEngine=PerconaFT/ /etc/mongod.conf
         sed -i'' s/^auth/#auth/ /etc/mongod.conf

10. Start the server

        service mongod start

11. Restore the collections without indexes

        mongorestore --noIndexRestore {dump path}/

12. Restore the indexes  (this may take a while)

        ./psmdb_restore_indexes.js --eval " data='{dump path}/tokumxIndexes.json' "

13. Run the `allDbStats.js` script to record db state after migration
 
        mongo  ./allDbStats.js > ~/allDbStats.after.out


14. Stop server

        service mongod stop

15. Enable authentication

         sed -i'' s/^i#auth/auth/ /etc/mongod.conf

16. Start server

         service mongod start

