#!/bin/bash

# This script will build a tarball distribution of toku2mongo on
# a specific platform and distribution
#
# first follow the instructions at: https://github.com/Tokutek/mongo/blob/master/docs/building.md
# for checking out the source and linking the dependencies.   Use the tag tokumx-2.0.2 instead
# of tokumx-1.4.0.  When the instructions get the cmake command, run this script instead and
# it should build toku2mongo for you.
#
# When finished, you should have the file mongo/build/toku2mongo-2.0.2.tar.gz which you can
# copy to your target system and run.

basedir=$(cd $(dirname "$0");pwd)

cd ../mongo
git checkout new_toku2mongo
mkdir build
cd build
cmake -D CMAKE_BUILD_TYPE=Release -D TOKU_DEBUG_PARANOID=OFF -D USE_VALGRIND=OFF -D USE_BDB=OFF -D BUILD_TESTING=OFF -D TOKUMX_DISTNAME=2.0.2 ..
make -j8 VERBOSE=1 toku2mongo 
mkdir -p toku2mongo-2.0.2/bin toku2mongo-2.0.2/lib64
cp -av src/mongo/toku2mongo toku2mongo-2.0.2/bin/
cp -av $(find . -name 'libtoku*.so') toku2mongo-2.0.2/lib64/
cd toku2mongo-2.0.2/bin/
chrpath -r '$ORIGIN/../lib64' toku2mongo 
cd ../..
tar czvf toku2mongo-2.0.2.tar.gz toku2mongo-2.0.2/
